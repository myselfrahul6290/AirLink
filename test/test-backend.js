const assert = require('assert');
const http = require('http');
const WebSocket = require('ws');

// Test on custom port to avoid collision
process.env.PORT = '3999';
require('../server.js');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function postJson(path, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3999,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, body });
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({
      hostname: '127.0.0.1',
      port: 3999,
      path
    }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, body });
        }
      });
    }).on('error', reject);
  });
}

function del(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3999,
      path,
      method: 'DELETE'
    }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, body });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function runTests() {
  await sleep(600); // Allow server to bind

  console.log('Testing CLI share creation...');
  const shareRes = await postJson('/api/cli-share', {
    filename: 'test.txt',
    size: 1024,
    mimeType: 'text/plain'
  });
  assert.strictEqual(shareRes.status, 200);
  assert.strictEqual(shareRes.body.success, true);
  assert.ok(shareRes.body.code);
  const code = shareRes.body.code;

  console.log('Testing CLI transfer status check...');
  const statusRes = await get(`/api/cli-status/${code}`);
  assert.strictEqual(statusRes.status, 200);
  assert.strictEqual(statusRes.body.filename, 'test.txt');
  assert.strictEqual(statusRes.body.size, 1024);

  console.log('Testing WebSocket peer registration and CLI token bind...');
  const ws = new WebSocket('ws://127.0.0.1:3999');
  await new Promise((resolve, reject) => {
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'register-peer', peerId: null }));
    });
    ws.on('message', data => {
      const msg = JSON.parse(data);
      if (msg.type === 'registered') {
        assert.strictEqual(msg.success, true);
        assert.ok(msg.peerId);
        // Test binding CLI token
        ws.send(JSON.stringify({ type: 'cli-bind-token', code }));
      } else if (msg.type === 'cli-token-bound') {
        assert.strictEqual(msg.code, code);
        resolve();
      }
    });
    ws.on('error', reject);
  });

  ws.close();

  console.log('Testing CLI transfer cancel...');
  const delRes = await del(`/api/cli-cancel/${code}`);
  assert.strictEqual(delRes.status, 200);
  assert.strictEqual(delRes.body.success, true);

  const afterDelRes = await get(`/api/cli-status/${code}`);
  assert.strictEqual(afterDelRes.status, 404);

  console.log('All backend checks passed successfully!');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
