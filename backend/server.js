const http = require('http');
const WebSocket = require('ws');
const app = require('./app');
const SignalingService = require('./services/signalingService');
const { getLocalIPs } = require('./utils/network');

const PORT = process.env.PORT || 3000;

// Create HTTP server
const server = http.createServer(app);

// Initialize WebSocket server
const wss = new WebSocket.Server({ server });

// Attach signaling service
const signalingService = new SignalingService(PORT);
signalingService.attach(wss);

// Start server listening
server.listen(PORT, () => {
  console.log('===================================================');
  console.log('AirLink P2P Signaling Engine Active!');
  console.log('---------------------------------------------------');
  console.log(`Local Access:  http://localhost:${PORT}`);

  const localIPs = getLocalIPs();
  if (localIPs.length > 0) {
    console.log('LAN Access:');
    localIPs.forEach(ip => {
      console.log(`               http://${ip}:${PORT}`);
    });
  }
  console.log('===================================================');
});

module.exports = { server, app, signalingService };
