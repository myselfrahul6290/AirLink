const WebSocket = require('ws');

class TransferService {
  constructor() {
    // In-Memory state for CLI / Terminal zero-disk streaming transfers
    // Key: code (string, e.g. "482910") -> Transfer slot
    this.transfers = new Map();
  }

  generateCode() {
    let attempts = 0;
    while (attempts < 1000) {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      if (!this.transfers.has(code)) {
        return code;
      }
      attempts++;
    }
    return String(Date.now()).slice(-6);
  }

  createTransfer({ filename, size, mimeType }) {
    const code = this.generateCode();
    const transfer = {
      code,
      filename: String(filename),
      size: Number(size),
      mimeType: mimeType || 'application/octet-stream',
      status: 'waiting', // 'waiting' | 'receiver_connected' | 'streaming' | 'completed' | 'cancelled' | 'error'
      receiverRes: null,
      senderReq: null,
      wsClient: null,
      bytesTransferred: 0,
      timer: setTimeout(() => {
        console.log(`[CLI Transfer Expired] Code: ${code}`);
        this.cleanupTransfer(code);
      }, 15 * 60 * 1000) // 15 minute TTL
    };

    this.transfers.set(code, transfer);
    console.log(`[CLI Share Created] Code: ${code} | File: ${transfer.filename} (${transfer.size} bytes)`);
    return transfer;
  }

  getTransfer(code) {
    const cleanCode = (code || '').replace(/\D/g, '');
    return this.transfers.get(cleanCode) || null;
  }

  bindWebSocket(code, ws) {
    const transfer = this.getTransfer(code);
    if (!transfer) return false;

    transfer.wsClient = ws;
    ws.cliCode = transfer.code;
    console.log(`[WS Bound to CLI Code] Code: ${transfer.code}`);

    this.notifyWs(transfer, {
      type: 'cli-token-bound',
      code: transfer.code,
      status: transfer.status
    });
    return true;
  }

  unbindWebSocket(ws) {
    if (!ws.cliCode) return;
    const transfer = this.getTransfer(ws.cliCode);
    if (transfer && transfer.wsClient === ws) {
      transfer.wsClient = null;
    }
  }

  notifyWs(transfer, messageObj) {
    if (transfer && transfer.wsClient && transfer.wsClient.readyState === WebSocket.OPEN) {
      try {
        transfer.wsClient.send(JSON.stringify(messageObj));
      } catch (err) {
        console.error(`[WS Send Error Code: ${transfer.code}]`, err);
      }
    }
  }

  cleanupTransfer(code, delayMs = 0) {
    const cleanCode = (code || '').replace(/\D/g, '');
    const doCleanup = () => {
      const transfer = this.transfers.get(cleanCode);
      if (!transfer) return;

      if (transfer.timer) clearTimeout(transfer.timer);
      if (transfer.receiverRes && !transfer.receiverRes.writableEnded) {
        try { transfer.receiverRes.end(); } catch (e) {}
      }
      if (transfer.senderReq && !transfer.senderReq.destroyed) {
        try { transfer.senderReq.destroy(); } catch (e) {}
      }
      this.transfers.delete(cleanCode);
      console.log(`[CLI Transfer Cleaned] Code: ${cleanCode}`);
    };

    if (delayMs > 0) {
      setTimeout(doCleanup, delayMs);
    } else {
      doCleanup();
    }
  }
}

// Export singleton instance
module.exports = new TransferService();
