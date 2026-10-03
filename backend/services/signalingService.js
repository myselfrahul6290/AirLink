const WebSocket = require('ws');
const { getLocalIPs, normalizeIp } = require('../utils/network');
const transferService = require('./transferService');

class SignalingService {
  constructor(port = process.env.PORT || 3000) {
    this.port = port;
    this.peers = new Map(); // peerId -> WebSocket
    this.socketToPeerId = new Map(); // WebSocket -> peerId
    this.ipToSockets = new Map(); // ip -> Set<WebSocket>
    this.pendingHandshakes = new Map(); // senderId -> targetId (for bidirectional handshake coordination)
    this.MAX_SOCKETS_PER_IP = process.env.MAX_SOCKETS_PER_IP ? parseInt(process.env.MAX_SOCKETS_PER_IP, 10) : 100;
    this.socketIdCounter = 0;

    // Command/Strategy pattern: Dispatch map for incoming WebSocket messages
    this.messageHandlers = {
      'register-peer': this.handleRegisterPeer.bind(this),
      'initiate-connect': this.handleInitiateConnect.bind(this),
      'signal-relay': this.handleSignalRelay.bind(this),
      'ping': this.handlePing.bind(this),
      'cli-bind-token': this.handleCliBindToken.bind(this)
    };
  }

  generateDeskId() {
    let attempts = 0;
    while (attempts < 1000) {
      const segment1 = Math.floor(100 + Math.random() * 900);
      const segment2 = Math.floor(100 + Math.random() * 900);
      const generatedId = `${segment1}-${segment2}`;
      if (!this.peers.has(generatedId)) {
        return generatedId;
      }
      attempts++;
    }
    return String(Date.now()).slice(-6).replace(/(\d{3})(\d{3})/, '$1-$2');
  }

  attach(wss) {
    this.wss = wss;
    wss.on('connection', (ws, req) => this.handleConnection(ws, req));
  }

  handleConnection(ws, req) {
    const socketId = `ws_${++this.socketIdCounter}`;
    // Support reverse proxies / Cloudflare
    const forwarded = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'];
    const rawIp = forwarded ? String(forwarded).split(',')[0].trim() : (req.socket.remoteAddress || 'unknown');
    const ip = normalizeIp(rawIp);
    const port = req.socket.remotePort;

    // IP Throttling: track sockets per IP (allow high limit for local/testing)
    if (!this.ipToSockets.has(ip)) {
      this.ipToSockets.set(ip, new Set());
    }
    const socketsForIp = this.ipToSockets.get(ip);
    const ipLimit = (ip === '127.0.0.1' || ip === 'localhost') ? 1000 : this.MAX_SOCKETS_PER_IP;

    if (socketsForIp.size >= ipLimit) {
      console.warn(`[Socket Rejected] IP ${ip} reached limit (${ipLimit}). Rejecting ${socketId}.`);
      ws.close(1008, 'Max connections per IP exceeded');
      return;
    }

    socketsForIp.add(ws);
    console.log(`[Socket connected] ID: ${socketId} | ${ip}:${port} | Active for IP: ${socketsForIp.size}`);

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        const handler = this.messageHandlers[data.type];
        if (handler) {
          handler(ws, data, socketId);
        } else {
          console.log('[Unknown message type]', data.type);
        }
      } catch (err) {
        console.error('[Error parsing socket payload]', err);
      }
    });

    ws.on('close', () => this.handleClose(ws, ip, socketId));
  }

  handleRegisterPeer(ws, data, socketId) {
    let peerId = data.peerId;
    const localIPs = getLocalIPs();

    // Prevent re-generating ID if socket already assigned
    const alreadyAssignedId = this.socketToPeerId.get(ws);
    if (alreadyAssignedId) {
      peerId = alreadyAssignedId;
    } else if (!peerId) {
      peerId = this.generateDeskId();
    }

    // Close older socket if replacing
    if (this.peers.has(peerId)) {
      const existingSocket = this.peers.get(peerId);
      if (existingSocket !== ws) {
        try {
          this.socketToPeerId.delete(existingSocket);
          existingSocket.close(1000, 'Replaced by newer connection');
        } catch (e) {}
      }
    }

    this.peers.set(peerId, ws);
    this.socketToPeerId.set(ws, peerId);
    console.log(`[Peer Registered] Desk ID: ${peerId} (Socket: ${socketId})`);

    ws.send(JSON.stringify({
      type: 'registered',
      success: true,
      peerId: peerId,
      lanIp: localIPs.length > 0 ? localIPs[0] : null,
      port: this.port
    }));
  }

  handleInitiateConnect(ws, data) {
    const senderId = this.socketToPeerId.get(ws);
    let targetId = data.targetId;

    if (typeof targetId === 'string') {
      const clean = targetId.replace(/\D/g, '');
      if (clean.length === 6) {
        targetId = `${clean.slice(0, 3)}-${clean.slice(3, 6)}`;
      } else {
        targetId = targetId.trim();
      }
    }

    console.log(`[Link Request] Sender ${senderId} -> Receiver ${targetId}`);

    if (!senderId) {
      ws.send(JSON.stringify({
        type: 'connect-failed',
        reason: 'You must be registered first.'
      }));
      return;
    }

    if (senderId === targetId) {
      ws.send(JSON.stringify({
        type: 'connect-failed',
        reason: 'Cannot establish a connection to your own desk address.'
      }));
      return;
    }

    if (!this.peers.has(targetId)) {
      ws.send(JSON.stringify({
        type: 'connect-failed',
        reason: 'Remote Desk is offline or does not exist.'
      }));
      return;
    }

    const targetSocket = this.peers.get(targetId);

    // Bidirectional glare resolution: if target already initiated to sender, coordinate gracefully
    const existingIntent = this.pendingHandshakes.get(targetId);
    if (existingIntent === senderId) {
      this.pendingHandshakes.delete(targetId);
      this.pendingHandshakes.delete(senderId);

      // Deterministically elect one offerer (lexicographical order)
      const offererId = senderId < targetId ? senderId : targetId;
      const answererId = senderId < targetId ? targetId : senderId;
      const offererSocket = this.peers.get(offererId);
      const answererSocket = this.peers.get(answererId);

      if (offererSocket && answererSocket) {
        console.log(`[Link Glare Resolved] Handshake coordinated: Offerer ${offererId} -> Answerer ${answererId}`);
        offererSocket.send(JSON.stringify({
          type: 'connect-approved',
          targetId: answererId
        }));
        answererSocket.send(JSON.stringify({
          type: 'peer-linking',
          senderId: offererId
        }));
        return;
      }
    }

    this.pendingHandshakes.set(senderId, targetId);
    setTimeout(() => {
      if (this.pendingHandshakes.get(senderId) === targetId) {
        this.pendingHandshakes.delete(senderId);
      }
    }, 20000);

    console.log(`[Link Approved] Handshake authorized: ${senderId} <-> ${targetId}`);
    this.pendingHandshakes.delete(senderId);
    this.pendingHandshakes.delete(targetId);

    ws.send(JSON.stringify({
      type: 'connect-approved',
      targetId: targetId
    }));

    targetSocket.send(JSON.stringify({
      type: 'peer-linking',
      senderId: senderId
    }));
  }

  handleSignalRelay(ws, data) {
    const senderId = this.socketToPeerId.get(ws);
    const { targetId, payload } = data;

    if (!senderId) return;

    if (this.peers.has(targetId)) {
      const targetSocket = this.peers.get(targetId);
      targetSocket.send(JSON.stringify({
        type: 'signal-relay',
        senderId: senderId,
        payload: payload
      }));
    } else {
      console.log(`[Relay Failed] Destination ${targetId} went offline during handshake.`);
      ws.send(JSON.stringify({
        type: 'peer-offline',
        peerId: targetId
      }));
    }
  }

  handlePing(ws) {
    ws.send(JSON.stringify({ type: 'pong' }));
  }

  handleCliBindToken(ws, data) {
    transferService.bindWebSocket(data.code, ws);
  }

  handleClose(ws, ip, socketId) {
    // Untrack from IP map
    const socketsForIp = this.ipToSockets.get(ip);
    if (socketsForIp) {
      socketsForIp.delete(ws);
      if (socketsForIp.size === 0) {
        this.ipToSockets.delete(ip);
      }
    }

    // Unbind from CLI transfer
    transferService.unbindWebSocket(ws);

    const peerId = this.socketToPeerId.get(ws);
    console.log(`[Socket Closed] ID: ${socketId}, Associated Desk ID: ${peerId || 'None'}`);

    if (peerId) {
      this.pendingHandshakes.delete(peerId);
      this.socketToPeerId.delete(ws);
      if (this.peers.get(peerId) === ws) {
        this.peers.delete(peerId);

        // Broadcast peer-disconnected
        if (this.wss) {
          this.wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({
                type: 'peer-disconnected',
                peerId: peerId
              }));
            }
          });
        }
      }
    }
  }
}

module.exports = SignalingService;
