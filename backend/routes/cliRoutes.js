const express = require('express');
const router = express.Router();
const transferService = require('../services/transferService');
const { getLocalIPs } = require('../utils/network');

const PORT = process.env.PORT || 3000;

// Step 1: Web UI registers a file for CLI transfer and reserves short code
router.post('/api/cli-share', (req, res) => {
  const { filename, size, mimeType } = req.body;
  if (!filename || typeof size !== 'number') {
    return res.status(400).json({ error: 'Filename and valid file size in bytes are required.' });
  }

  const transfer = transferService.createTransfer({ filename, size, mimeType });

  res.json({
    success: true,
    code: transfer.code,
    formattedCode: `${transfer.code.slice(0, 3)}-${transfer.code.slice(3, 6)}`,
    filename: transfer.filename,
    size: transfer.size,
    downloadPath: `/d/${transfer.code}`,
    lanIps: getLocalIPs(),
    port: PORT
  });
});

// Step 2: Ubuntu / Linux Terminal runs `curl -OJ http://<ip>:3000/d/<code>`
const handleCliDownload = (req, res) => {
  const rawCode = req.params.code || '';
  const transfer = transferService.getTransfer(rawCode);

  if (!transfer) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(404).send(`\n❌ Error: Transfer code "${rawCode}" not found or expired.\nPlease generate a new command from the web interface.\n\n`);
  }

  if (transfer.status === 'completed') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(410).send(`\n⚠️ Notice: Transfer "${transfer.code}" has already completed.\n\n`);
  }

  if (transfer.receiverRes && !transfer.receiverRes.writableEnded) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(409).send(`\n⚠️ Notice: Another terminal receiver is already connected to transfer "${transfer.code}".\n\n`);
  }

  // Set response headers for curl / wget
  transfer.receiverRes = res;
  transfer.status = 'receiver_connected';

  // Format Content-Disposition with RFC 5987 UTF-8 support
  const asciiName = transfer.filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '\\"');
  const encodedName = encodeURIComponent(transfer.filename).replace(/['()]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()).replace(/\*/g, '%2A');

  res.setHeader('Content-Type', transfer.mimeType || 'application/octet-stream');
  res.setHeader('Content-Length', transfer.size);
  res.setHeader('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`);
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable buffering on reverse proxies for live streaming

  console.log(`[CLI Receiver Connected] Code: ${transfer.code} from ${req.ip} (${req.headers['user-agent'] || 'curl'})`);

  // Notify sender web browser via WebSocket
  transferService.notifyWs(transfer, {
    type: 'cli-receiver-connected',
    code: transfer.code,
    filename: transfer.filename,
    size: transfer.size,
    userAgent: req.headers['user-agent'] || 'curl'
  });

  // Handle client abort / disconnect (e.g. Ctrl+C in Ubuntu terminal)
  req.on('close', () => {
    if (transfer.status !== 'completed') {
      console.log(`[CLI Receiver Disconnected early] Code: ${transfer.code}`);
      transfer.status = 'cancelled';
      transferService.notifyWs(transfer, {
        type: 'cli-receiver-disconnected',
        code: transfer.code
      });
      if (transfer.senderReq && !transfer.senderReq.destroyed) {
        transfer.senderReq.destroy();
      }
    }
  });
};

router.get('/d/:code', handleCliDownload);

// Step 3: Browser streams file data directly to receiverRes (Zero Server Disk Storage)
router.post('/api/cli-upload/:code', (req, res) => {
  const transfer = transferService.getTransfer(req.params.code);

  if (!transfer) {
    return res.status(404).json({ error: 'Transfer not found or expired.' });
  }

  if (!transfer.receiverRes || transfer.receiverRes.writableEnded) {
    return res.status(400).json({ error: 'No terminal receiver currently connected.' });
  }

  transfer.senderReq = req;
  transfer.status = 'streaming';
  console.log(`[CLI Streaming Started] Code: ${transfer.code} -> Direct RAM Pipe to Terminal (Zero Disk Storage)`);

  let lastReportedTime = Date.now();

  req.on('data', (chunk) => {
    transfer.bytesTransferred += chunk.length;

    // Push progress over WebSocket to UI
    const now = Date.now();
    if (now - lastReportedTime >= 400) {
      transferService.notifyWs(transfer, {
        type: 'cli-transfer-progress',
        code: transfer.code,
        bytesTransferred: transfer.bytesTransferred,
        totalBytes: transfer.size
      });
      lastReportedTime = now;
    }
  });

  // Pipe incoming request stream directly into terminal receiver's HTTP response
  req.pipe(transfer.receiverRes);

  req.on('end', () => {
    transfer.status = 'completed';
    console.log(`[CLI Transfer Completed] Code: ${transfer.code} | Total: ${transfer.bytesTransferred} bytes streamed.`);

    transferService.notifyWs(transfer, {
      type: 'cli-transfer-complete',
      code: transfer.code,
      bytesTransferred: transfer.bytesTransferred
    });

    res.json({ success: true, bytesTransferred: transfer.bytesTransferred });
    transferService.cleanupTransfer(transfer.code, 8000); // 8s grace period before memory eviction
  });

  req.on('error', (err) => {
    console.error(`[CLI Upload Stream Error ${transfer.code}]`, err);
    transfer.status = 'error';
    if (transfer.receiverRes && !transfer.receiverRes.writableEnded) {
      transfer.receiverRes.destroy(err);
    }
    res.status(500).json({ error: 'Stream error during upload' });
  });
});

// Check status of a transfer slot (used for UI fallback polling)
router.get('/api/cli-status/:code', (req, res) => {
  const transfer = transferService.getTransfer(req.params.code);
  if (!transfer) {
    return res.status(404).json({ error: 'Transfer not found or expired' });
  }
  res.json({
    code: transfer.code,
    filename: transfer.filename,
    size: transfer.size,
    status: transfer.status,
    bytesTransferred: transfer.bytesTransferred,
    hasReceiver: !!(transfer.receiverRes && !transfer.receiverRes.writableEnded)
  });
});

// Cancel transfer slot
router.delete('/api/cli-cancel/:code', (req, res) => {
  transferService.cleanupTransfer(req.params.code);
  res.json({ success: true, message: 'Transfer cancelled.' });
});

module.exports = router;
