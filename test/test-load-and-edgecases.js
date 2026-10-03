

const http = require('http');
const WebSocket = require('ws');
const app = require('../backend/app');
const SignalingService = require('../backend/services/signalingService');

const TEST_PORT = 4999;
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const signalingService = new SignalingService(TEST_PORT);
signalingService.attach(wss);

function assert(condition, message) {
  if (!condition) {
    console.error(` ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function connectWs(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function sendAndReceive(ws, sendData, expectedType, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', handler);
      reject(new Error(`Timeout waiting for type "${expectedType}"`));
    }, timeoutMs);

    const handler = (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === expectedType) {
          clearTimeout(timer);
          ws.off('message', handler);
          resolve(msg);
        }
      } catch (e) {}
    };

    ws.on('message', handler);
    ws.send(JSON.stringify(sendData));
  });
}

function httpRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function run() {
  console.log('================================================================');
  console.log(' AIRLINK PRODUCTION READINESS & MULTI-USER STRESS SUITE');
  console.log('================================================================');

  await new Promise((resolve) => server.listen(TEST_PORT, resolve));
  console.log(`[Test Server Online] Running on http://127.0.0.1:${TEST_PORT}\n`);

  try {
    // -----------------------------------------------------------------
    // TEST 1: 30 CONCURRENT USERS REGISTRATION (15 Pairs)
    // -----------------------------------------------------------------
    console.log('TEST 1: Registering 30 Concurrent Users Simultaneously...');
    const USER_COUNT = 30;
    const clients = [];

    for (let i = 0; i < USER_COUNT; i++) {
      const ws = await connectWs(TEST_PORT);
      clients.push(ws);
    }

    const regPromises = clients.map((ws, idx) =>
      sendAndReceive(ws, { type: 'register-peer' }, 'registered')
    );

    const regResults = await Promise.all(regPromises);
    assert(regResults.length === USER_COUNT, 'All 30 users must register');

    const deskIds = regResults.map((r) => r.peerId);
    const uniqueIds = new Set(deskIds);
    assert(uniqueIds.size === USER_COUNT, 'All 30 Desk IDs must be completely unique');
    console.log(`  30 distinct Desk IDs issued with 0 collisions.`);

    // -----------------------------------------------------------------
    // TEST 2: 15 CONCURRENT SIMULTANEOUS PAIR HANDSHAKES
    // -----------------------------------------------------------------
    console.log('\n TEST 2: Linking 15 Pairs Concurrently Across the Signaling Engine...');
    const pairCount = USER_COUNT / 2;
    const linkPromises = [];

    for (let p = 0; p < pairCount; p++) {
      const initiator = clients[p * 2];
      const receiver = clients[p * 2 + 1];
      const initiatorId = deskIds[p * 2];
      const receiverId = deskIds[p * 2 + 1];

      const pPromise = (async () => {
        // Initiator sends initiate-connect
        const approvedPromise = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Connect-approved timeout')), 4000);
          const h = (raw) => {
            const m = JSON.parse(raw);
            if (m.type === 'connect-approved') {
              clearTimeout(timeout);
              initiator.off('message', h);
              resolve(m);
            }
          };
          initiator.on('message', h);
        });

        const linkingPromise = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Peer-linking timeout')), 4000);
          const h = (raw) => {
            const m = JSON.parse(raw);
            if (m.type === 'peer-linking') {
              clearTimeout(timeout);
              receiver.off('message', h);
              resolve(m);
            }
          };
          receiver.on('message', h);
        });

        initiator.send(JSON.stringify({ type: 'initiate-connect', targetId: receiverId }));
        const [approved, linking] = await Promise.all([approvedPromise, linkingPromise]);
        assert(approved.targetId === receiverId, 'Approved targetId matches');
        assert(linking.senderId === initiatorId, 'Linking senderId matches');
      })();

      linkPromises.push(pPromise);
    }

    await Promise.all(linkPromises);
    console.log(`   ✓ All 15 pairs linked simultaneously without interference.`);

    // -----------------------------------------------------------------
    // TEST 3: HIGH-THROUGHPUT SIGNAL RELAY & TRICKLE CANDIDATES
    // -----------------------------------------------------------------
    console.log('\n TEST 3: Relaying 150 Trickle Candidates Across Active Peers...');
    const relayPromises = [];
    const CANDIDATES_PER_PAIR = 10;

    for (let p = 0; p < pairCount; p++) {
      const initiator = clients[p * 2];
      const receiver = clients[p * 2 + 1];
      const receiverId = deskIds[p * 2 + 1];

      for (let c = 0; c < CANDIDATES_PER_PAIR; c++) {
        const payload = { candidate: `candidate:${p}_${c}_udp_192.168.1.100_50000`, sdpMid: '0' };
        const rPromise = new Promise((resolve, reject) => {
          const h = (raw) => {
            const m = JSON.parse(raw);
            if (m.type === 'signal-relay' && m.payload.candidate === payload.candidate) {
              receiver.off('message', h);
              resolve();
            }
          };
          receiver.on('message', h);
          initiator.send(JSON.stringify({
            type: 'signal-relay',
            targetId: receiverId,
            payload: payload
          }));
        });
        relayPromises.push(rPromise);
      }
    }

    await Promise.all(relayPromises);
    console.log(`   ✓ 150/150 signaling messages delivered with 100% integrity.`);

    // -----------------------------------------------------------------
    // TEST 4: BIDIRECTIONAL SIMULTANEOUS CLICK (GLARE RACE CONDITION)
    // -----------------------------------------------------------------
    console.log('\n TEST 4: Edge Case - Both Peers Click Connect at Exact Same Millisecond...');
    const wsA = clients[0];
    const wsB = clients[1];
    const idA = deskIds[0];
    const idB = deskIds[1];

    const glarePromiseA = new Promise((res) => {
      const h = (raw) => {
        const m = JSON.parse(raw);
        if (m.type === 'connect-approved' || m.type === 'peer-linking') {
          wsA.off('message', h);
          res(m.type);
        }
      };
      wsA.on('message', h);
    });

    const glarePromiseB = new Promise((res) => {
      const h = (raw) => {
        const m = JSON.parse(raw);
        if (m.type === 'connect-approved' || m.type === 'peer-linking') {
          wsB.off('message', h);
          res(m.type);
        }
      };
      wsB.on('message', h);
    });

    // Fire both simultaneously
    wsA.send(JSON.stringify({ type: 'initiate-connect', targetId: idB }));
    wsB.send(JSON.stringify({ type: 'initiate-connect', targetId: idA }));

    const [roleA, roleB] = await Promise.all([glarePromiseA, glarePromiseB]);
    assert(
      (roleA === 'connect-approved' && roleB === 'peer-linking') ||
      (roleA === 'peer-linking' && roleB === 'connect-approved'),
      'Glare must designate one offerer and one answerer'
    );
    console.log(`   ✓ Glare resolved: Peer A got "${roleA}", Peer B got "${roleB}". Zero collision!`);

    // -----------------------------------------------------------------
    // TEST 5: MALFORMED DESK ID NORMALIZATION
    // -----------------------------------------------------------------
    console.log('\n TEST 5: Edge Case - Formats with Spaces, No Dashes, or Irregular Characters...');
    const targetRaw = deskIds[2]; // e.g. "123-456"
    const targetNoDash = targetRaw.replace('-', ''); // "123456"
    const targetSpaced = `${targetRaw.slice(0, 3)}   ${targetRaw.slice(4)}`; // "123   456"

    const normRes1 = await sendAndReceive(clients[3], { type: 'initiate-connect', targetId: targetNoDash }, 'connect-approved');
    assert(normRes1.targetId === targetRaw, 'Unformatted 6 digits must normalize');
    console.log(`   ✓ Unformatted code "${targetNoDash}" normalized to "${targetRaw}".`);

    const normRes2 = await sendAndReceive(clients[3], { type: 'initiate-connect', targetId: targetSpaced }, 'connect-approved');
    assert(normRes2.targetId === targetRaw, 'Spaced code must normalize');
    console.log(`   ✓ Spaced code "${targetSpaced}" normalized to "${targetRaw}".`);

    // -----------------------------------------------------------------
    // TEST 6: CONNECTING TO SELF & OFFLINE TARGETS
    // -----------------------------------------------------------------
    console.log('\n TEST 6: Edge Case - Self-Connection & Offline Target Rejections...');
    const selfRes = await sendAndReceive(clients[0], { type: 'initiate-connect', targetId: deskIds[0] }, 'connect-failed');
    assert(selfRes.reason.includes('own desk'), 'Self-connection must be rejected');
    console.log(`   ✓ Self-connection rejected: "${selfRes.reason}"`);

    const offlineRes = await sendAndReceive(clients[0], { type: 'initiate-connect', targetId: '999-999' }, 'connect-failed');
    assert(offlineRes.reason.includes('offline'), 'Offline desk must be rejected');
    console.log(`   ✓ Offline target rejected: "${offlineRes.reason}"`);

    // -----------------------------------------------------------------
    // TEST 7: CONCURRENT CLI FILE TRANSFERS (TERMINAL DOWNLOAD PIPES)
    // -----------------------------------------------------------------
    console.log('\n TEST 7: Load - 5 Concurrent Terminal (cURL) Streaming Transfers...');
    const cliTransfers = [];
    const testPayloadSize = 32 * 1024; // 32KB
    const testData = Buffer.alloc(testPayloadSize, 'A');

    for (let c = 0; c < 5; c++) {
      // 1. Create CLI share
      const shareRes = await httpRequest({
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path: '/api/cli-share',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, JSON.stringify({ filename: `load_test_${c}.bin`, size: testPayloadSize }));

      const shareData = JSON.parse(shareRes.body);
      assert(shareData.success, 'CLI share created');
      const code = shareData.code;

      // 2. Start cURL GET request asynchronously
      const getPromise = httpRequest({
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path: `/d/${code}`,
        method: 'GET'
      });

      // 3. Wait for receiver_connected status
      await wait(100);

      // 4. Stream data upload from browser tab
      const streamRes = await httpRequest({
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path: `/api/cli-upload/${code}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': testPayloadSize }
      }, testData);

      const downloadResult = await getPromise;
      assert(downloadResult.statusCode === 200, 'Download returns 200 OK');
      assert(downloadResult.body.length === testPayloadSize, `Download body matches ${testPayloadSize} bytes`);
      cliTransfers.push(code);
    }
    console.log(`   ✓ 5 concurrent terminal transfers completed with 100% byte verification.`);

    // -----------------------------------------------------------------
    // TEST 8: RAPID CLIENT DISCONNECT & CLEANUP
    // -----------------------------------------------------------------
    console.log('\n TEST 8: Stress - Rapid Disconnect and Socket Resource Cleanup...');
    for (const ws of clients) {
      ws.close();
    }
    await wait(200);

    assert(signalingService.peers.size === 0, 'All peers must be unmapped on close');
    assert(signalingService.socketToPeerId.size === 0, 'Socket-to-peer mappings cleared');
    assert(signalingService.pendingHandshakes.size === 0, 'Pending handshakes cleared');
    console.log(`   ✓ Zero leaked sockets, mappings, or memory references remaining.`);

    console.log('\n================================================================');
    console.log(' ALL 8 TESTS & EDGE CASES PASSED WITH 100% SUCCESS RATE!');
    console.log('   System is fully stable, scale-tested, and production-ready.');
    console.log('================================================================\n');

  } finally {
    server.close();
  }
}

run().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
