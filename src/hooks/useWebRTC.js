import { useState, useEffect, useRef, useCallback } from 'react';

const CHUNK_SIZE = 16384; // 16KB standard chunk size
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ],
  iceCandidatePoolSize: 10
};

export function useWebRTC() {
  const getOrCreateDeviceDeskId = () => {
    try {
      const stored = sessionStorage.getItem('airlink_client_id') || localStorage.getItem('airlink_client_id');
      if (stored && /^\d{3}-\d{3}$/.test(stored)) {
        sessionStorage.setItem('airlink_client_id', stored);
        return stored;
      }
      const seg1 = Math.floor(100 + Math.random() * 900);
      const seg2 = Math.floor(100 + Math.random() * 900);
      const newId = `${seg1}-${seg2}`;
      sessionStorage.setItem('airlink_client_id', newId);
      localStorage.setItem('airlink_client_id', newId);
      return newId;
    } catch (e) {
      const seg1 = Math.floor(100 + Math.random() * 900);
      const seg2 = Math.floor(100 + Math.random() * 900);
      return `${seg1}-${seg2}`;
    }
  };

  // --- STATE ---
  const [localId, setLocalId] = useState(getOrCreateDeviceDeskId);
  const [serverConnected, setServerConnected] = useState(false);
  const [activePeerId, setActivePeerId] = useState(null);
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [latency, setLatency] = useState('--');
  
  const [chatMessages, setChatMessages] = useState([]);
  const [activeTransfers, setActiveTransfers] = useState({});
  const [toasts, setToasts] = useState([]);
  const [lanUrl, setLanUrl] = useState(null);
  const [initialConnectId, setInitialConnectId] = useState(null);

  // --- REFS FOR WEBRTC STATE ---
  const wsRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const dataChannelRef = useRef(null);
  const connectionDirectionRef = useRef(null); // 'sender' or 'receiver'
  const activePeerIdRef = useRef(null);
  const activeReceivingFileRef = useRef(null);
  const autoConnectTargetRef = useRef(null);
  const localIdRef = useRef(getOrCreateDeviceDeskId());
  const pendingIceCandidatesRef = useRef([]);
  const connectionTimeoutRef = useRef(null);

  // --- PARSE URL PARAMS ONCE (QR SCAN AUTO-LINK) ---
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const targetParam = params.get('connect') || params.get('desk');
      if (targetParam) {
        const raw = targetParam.trim().replace(/\D/g, '');
        const formatted = raw.length === 6 ? `${raw.slice(0, 3)}-${raw.slice(3, 6)}` : targetParam.trim();
        setInitialConnectId(formatted);
        autoConnectTargetRef.current = formatted;
      }
    } catch (e) {
      console.error('Failed reading URL params', e);
    }
  }, []);

  // --- TOAST ALERTS HELPER ---
  const showToast = useCallback((title, message, type = 'info') => {
    const id = `toast_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    setToasts((prev) => [...prev, { id, title, message, type }]);
    
    // Auto-remove after 4 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // --- SYSTEM CHAT LOGS ---
  const appendSystemMessage = useCallback((text) => {
    setChatMessages((prev) => [...prev, { id: `sys_${Date.now()}`, type: 'system', text }]);
  }, []);

  // --- DISCONNECT & RESET ---
  const disconnectSession = useCallback(() => {
    // Notify peer
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && activePeerIdRef.current) {
      wsRef.current.send(JSON.stringify({
        type: 'signal-relay',
        targetId: activePeerIdRef.current,
        payload: { event: 'disconnect-peer' }
      }));
    }

    // Close components
    if (dataChannelRef.current) {
      try { dataChannelRef.current.close(); } catch(e){}
      dataChannelRef.current = null;
    }

    if (peerConnectionRef.current) {
      try { peerConnectionRef.current.close(); } catch(e){}
      peerConnectionRef.current = null;
    }

    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
    pendingIceCandidatesRef.current = [];

    setActivePeerId(null);
    activePeerIdRef.current = null;
    setIsWorkspaceOpen(false);
    setIsConnecting(false);
    setLatency('--');
    connectionDirectionRef.current = null;
  }, []);

  // --- WEBRTC SIGNAL RELAY SENDER ---
  const sendSignalingSignal = useCallback((targetId, payload) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'signal-relay',
        targetId: targetId,
        payload: payload
      }));
    }
  }, []);

  // --- MEASURE P2P LATENCY ---
  const measureLatency = useCallback(() => {
    if (!peerConnectionRef.current) return;
    
    const intervalId = setInterval(async () => {
      if (!peerConnectionRef.current || peerConnectionRef.current.iceConnectionState !== 'connected') {
        clearInterval(intervalId);
        return;
      }
      try {
        const stats = await peerConnectionRef.current.getStats();
        stats.forEach((report) => {
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            if (report.currentRoundTripTime !== undefined) {
              setLatency(Math.round(report.currentRoundTripTime * 1000));
            }
          }
        });
      } catch (err) {
        clearInterval(intervalId);
      }
    }, 3000);

    return () => clearInterval(intervalId);
  }, []);

  // --- INITIALIZE WEBRTC HANDSHAKE ---
  const createPeerConnection = useCallback((targetId) => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }

    pendingIceCandidatesRef.current = [];
    const pc = new RTCPeerConnection(rtcConfig);
    peerConnectionRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignalingSignal(targetId, { candidate: event.candidate });
      }
    };

    pc.oniceconnectionstatechange = () => {
      const iceState = pc.iceConnectionState;
      console.log(`WebRTC ICE: ${iceState}`);
      if (iceState === 'connected' || iceState === 'completed') {
        measureLatency();
      } else if (iceState === 'failed' || iceState === 'disconnected') {
        if (activePeerIdRef.current) {
          showToast('Connection Dropped', 'Direct WebRTC link collapsed.', 'error');
          disconnectSession();
        }
      }
    };

    if (connectionDirectionRef.current === 'receiver') {
      pc.ondatachannel = (event) => {
        dataChannelRef.current = event.channel;
        bindDataChannelEvents();
      };
    }

    return pc;
  }, [sendSignalingSignal, measureLatency, disconnectSession, showToast]);

  const initiateWebRTCLink = useCallback(async (targetId) => {
    try {
      const pc = createPeerConnection(targetId);
      
      const channel = pc.createDataChannel('airlink-data-channel', { ordered: true });
      dataChannelRef.current = channel;
      bindDataChannelEvents();

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      sendSignalingSignal(targetId, { sdp: pc.localDescription });
    } catch (e) {
      console.error('Vite WebRTC Offer generation failed:', e);
      showToast('WebRTC Error', 'Failed to generate SDP connection offer.', 'error');
      disconnectSession();
    }
  }, [createPeerConnection, sendSignalingSignal, disconnectSession, showToast]);

  // --- RELAYED SIGNALLING RECEIVER ---
  const handleSignalingSignal = useCallback(async (senderId, payload) => {
    try {
      if (payload.event === 'disconnect-peer') {
        showToast('Desk Offline', `Remote Desk ${senderId} disconnected.`, 'info');
        disconnectSession();
        return;
      }

      if (!peerConnectionRef.current) {
        connectionDirectionRef.current = 'receiver';
        activePeerIdRef.current = senderId;
        setActivePeerId(senderId);
        createPeerConnection(senderId);
      }

      const pc = peerConnectionRef.current;

      if (payload.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));

        // Drain any buffered trickle candidates
        while (pendingIceCandidatesRef.current.length > 0) {
          const queuedCand = pendingIceCandidatesRef.current.shift();
          try {
            await pc.addIceCandidate(new RTCIceCandidate(queuedCand));
          } catch (err) {
            console.warn('Error applying queued candidate:', err);
          }
        }

        if (pc.remoteDescription.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignalingSignal(senderId, { sdp: pc.localDescription });
        }
      } else if (payload.candidate) {
        // Buffer candidate if remoteDescription is not yet set
        if (!pc.remoteDescription || !pc.remoteDescription.type) {
          pendingIceCandidatesRef.current.push(payload.candidate);
        } else {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
          } catch (e) {
            console.warn('Error adding ICE candidate directly:', e);
          }
        }
      }
    } catch (e) {
      console.error('Error in handleSignalingSignal:', e);
    }
  }, [createPeerConnection, sendSignalingSignal, disconnectSession, showToast]);

  // --- BIND DATA CHANNEL EVENTS ---
  function bindDataChannelEvents() {
    const channel = dataChannelRef.current;
    if (!channel) return;

    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      console.log('React Data Channel Open!');
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
      }
      setIsConnecting(false);
      setIsWorkspaceOpen(true);
      setActivePeerId(activePeerIdRef.current);
      showToast('P2P Direct Secured', `Connected directly with Desk ${activePeerIdRef.current}!`, 'success');
      appendSystemMessage(`Direct P2P Secured with Desk ID ${activePeerIdRef.current}`);
    };

    channel.onclose = () => {
      console.log('React Data Channel Close.');
      showToast('Session Terminated', 'P2P pipeline closed.', 'info');
      disconnectSession();
    };

    channel.onerror = (e) => {
      console.error('React Data Channel Transport Error:', e);
      showToast('Pipeline Error', 'Data transport error encountered.', 'error');
    };

    channel.onmessage = (event) => {
      handleDataChannelMessage(event);
    };
  }

  // --- DATA PIPELINE: RECEIVER (ASSEMBLY) ---
  function handleDataChannelMessage(event) {
    const data = event.data;

    if (typeof data === 'string') {
      try {
        const payload = JSON.parse(data);
        
        if (payload.type === 'chat') {
          setChatMessages((prev) => [
            ...prev,
            { id: `msg_${Date.now()}`, type: 'peer', text: payload.text, timestamp: payload.timestamp }
          ]);
        }
        else if (payload.type === 'file-meta') {
          activeReceivingFileRef.current = {
            transferId: payload.transferId,
            name: payload.name,
            size: payload.size,
            mimeType: payload.mimeType,
            chunksTotal: payload.chunksTotal,
            chunksReceived: 0,
            bytesReceived: 0,
            buffer: []
          };

          setActiveTransfers((prev) => ({
            ...prev,
            [payload.transferId]: {
              id: payload.transferId,
              name: payload.name,
              size: payload.size,
              type: 'download',
              bytesTransferred: 0,
              speedText: '0 KB/s',
              etaText: 'Slicing Chunks...',
              percent: 0,
              status: 'active'
            }
          }));
        }
      } catch (err) {
        console.error('Error parsing text block:', err);
      }
    }
    else if (data instanceof ArrayBuffer) {
      const stream = activeReceivingFileRef.current;
      if (!stream) return;

      stream.buffer.push(data);
      stream.bytesReceived += data.byteLength;
      stream.chunksReceived++;

      const percentVal = Math.min(Math.round((stream.bytesReceived / stream.size) * 100), 100);

      // Speed tracker updates (throttled inside setState updates)
      setActiveTransfers((prev) => {
        const original = prev[stream.transferId];
        if (!original) return prev;
        
        return {
          ...prev,
          [stream.transferId]: {
            ...original,
            bytesTransferred: stream.bytesReceived,
            percent: percentVal,
            speedText: `${formatBytes(stream.bytesReceived / ((Date.now() - stream.transferId.split('_')[1]) / 1000))}/s`
          }
        };
      });

      if (stream.bytesReceived >= stream.size || stream.chunksReceived >= stream.chunksTotal) {
        const compiledBlob = new Blob(stream.buffer, { type: stream.mimeType });
        const downloadUrl = URL.createObjectURL(compiledBlob);

        setActiveTransfers((prev) => ({
          ...prev,
          [stream.transferId]: {
            ...prev[stream.transferId],
            status: 'complete',
            percent: 100,
            downloadUrl: downloadUrl,
            fileName: stream.name
          }
        }));

        showToast('File Received', `${stream.name} received successfully!`, 'success');
        activeReceivingFileRef.current = null;
      }
    }
  }

  // --- DATA PIPELINE: SENDER (SLICING & FLOW CONTROL) ---
  const streamFile = useCallback(async (file) => {
    if (!dataChannelRef.current || dataChannelRef.current.readyState !== 'open') {
      showToast('Failed to Send', 'No active direct channel open.', 'error');
      return;
    }

    const transferId = `tx_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    
    // Register details in UI state
    setActiveTransfers((prev) => ({
      ...prev,
      [transferId]: {
        id: transferId,
        name: file.name,
        size: file.size,
        type: 'upload',
        bytesTransferred: 0,
        speedText: '0 KB/s',
        etaText: 'Calculating...',
        percent: 0,
        status: 'active'
      }
    }));

    // Send metadata
    const metadata = {
      type: 'file-meta',
      transferId: transferId,
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      chunksTotal: totalChunks
    };
    
    dataChannelRef.current.send(JSON.stringify(metadata));

    // Slicing loop
    let offset = 0;
    const fileReader = new FileReader();
    dataChannelRef.current.bufferedAmountLowThreshold = 262144; // 256KB

    const readNextSlice = () => {
      if (offset >= file.size) {
        setActiveTransfers((prev) => ({
          ...prev,
          [transferId]: {
            ...prev[transferId],
            status: 'complete',
            percent: 100
          }
        }));
        return;
      }
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      fileReader.readAsArrayBuffer(slice);
    };

    fileReader.onload = (e) => {
      const arrayBuffer = e.target.result;
      
      try {
        dataChannelRef.current.send(arrayBuffer);
      } catch (err) {
        console.error('Transport buffer overflow:', err);
        showToast('Transfer Failed', 'Buffer overflowed. Reconnecting.', 'error');
        setActiveTransfers((prev) => ({
          ...prev,
          [transferId]: { ...prev[transferId], status: 'error' }
        }));
        return;
      }

      offset += arrayBuffer.byteLength;
      const percentVal = Math.min(Math.round((offset / file.size) * 100), 100);

      // Speed calculation
      const now = Date.now();
      const elapsed = (now - parseInt(transferId.split('_')[1])) / 1000;
      const speed = offset / elapsed;

      setActiveTransfers((prev) => {
        const original = prev[transferId];
        if (!original) return prev;
        return {
          ...prev,
          [transferId]: {
            ...original,
            bytesTransferred: offset,
            percent: percentVal,
            speedText: `${formatBytes(speed)}/s`
          }
        };
      });

      if (offset < file.size) {
        // Backpressure Flow Control threshold checking
        if (dataChannelRef.current.bufferedAmount > 1048576) {
          dataChannelRef.current.onbufferedamountlow = () => {
            dataChannelRef.current.onbufferedamountlow = null;
            readNextSlice();
          };
        } else {
          setTimeout(readNextSlice, 0);
        }
      } else {
        setActiveTransfers((prev) => ({
          ...prev,
          [transferId]: {
            ...prev[transferId],
            status: 'complete',
            percent: 100
          }
        }));
      }
    };

    fileReader.onerror = () => {
      showToast('Read Error', 'Could not slice local file.', 'error');
      setActiveTransfers((prev) => ({
        ...prev,
        [transferId]: { ...prev[transferId], status: 'error' }
      }));
    };

    readNextSlice();
  }, [showToast]);

  // --- SEND CHAT MESSAGES ---
  const sendChatMessage = useCallback((text) => {
    if (!dataChannelRef.current || dataChannelRef.current.readyState !== 'open') return;

    const timestamp = Date.now();
    const payload = {
      type: 'chat',
      text: text,
      timestamp: timestamp
    };
    
    dataChannelRef.current.send(JSON.stringify(payload));
    setChatMessages((prev) => [
      ...prev,
      { id: `msg_${Date.now()}`, type: 'me', text, timestamp }
    ]);
  }, []);

  // --- CONNECT TO REMOTE HANDSHAKE ---
  const connectToRemote = useCallback(async (targetId) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      showToast('Offline Mode', 'Not connected to matchmaking server.', 'error');
      return;
    }

    if (!targetId) {
      showToast('Missing Field', 'Please enter Remote Desk Address.', 'error');
      return;
    }

    // Robust normalization for 6-digit codes
    const cleanDigits = String(targetId).replace(/\D/g, '');
    const formattedTarget = cleanDigits.length === 6 
      ? `${cleanDigits.slice(0, 3)}-${cleanDigits.slice(3, 6)}` 
      : targetId.trim();

    setIsConnecting(true);
    connectionDirectionRef.current = 'sender';
    activePeerIdRef.current = formattedTarget;

    // Timeout watchdog (prevents indefinite freeze)
    if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
    connectionTimeoutRef.current = setTimeout(() => {
      showToast('Connection Timeout', 'Failed to link in time. Please verify the code and retry.', 'error');
      disconnectSession();
    }, 18000);

    wsRef.current.send(JSON.stringify({
      type: 'initiate-connect',
      targetId: formattedTarget
    }));
  }, [showToast, disconnectSession]);

  // --- HELPER: BYTES FORMATTER ---
  function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  // Stable callbacks container to avoid re-triggering the WebSocket effect
  const callbacksRef = useRef({});
  callbacksRef.current = {
    connectToRemote,
    handleSignalingSignal,
    initiateWebRTCLink,
    disconnectSession,
    showToast
  };

  // External WebSocket event listeners and message dispatcher
  const wsListenersRef = useRef(new Set());

  const addWsListener = useCallback((handler) => {
    wsListenersRef.current.add(handler);
    return () => {
      wsListenersRef.current.delete(handler);
    };
  }, []);

  const sendWsMessage = useCallback((payload) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      if (typeof payload === 'string' || payload instanceof ArrayBuffer || payload instanceof Uint8Array || payload instanceof Blob) {
        wsRef.current.send(payload);
      } else {
        wsRef.current.send(JSON.stringify(payload));
      }
      return true;
    }
    return false;
  }, []);

  const getWsBufferedAmount = useCallback(() => {
    return wsRef.current ? wsRef.current.bufferedAmount : 0;
  }, []);

  // --- SETUP WEBSOCKET CONNECTION ---
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host || 'localhost:3000';
    // Handle proxy or local connections
    const wsUrl = `${protocol}//${host}`;

    console.log(`React Client connecting WebSocket to ${wsUrl}`);
    let ws = null;
    let keepAlive = null;
    let reconnectTimer = null;
    let isUnmounted = false;

    function connect() {
      if (isUnmounted) return;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
        return;
      }

      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isUnmounted) {
          ws.close();
          return;
        }
        setServerConnected(true);
        callbacksRef.current.showToast?.('Connected to Signaling', 'Ready to register Desk ID.', 'info');
        
        // Auto register on connect with sticky/saved ID if available
        const currentSavedId = localIdRef.current || sessionStorage.getItem('airlink_client_id');
        ws.send(JSON.stringify({
          type: 'register-peer',
          peerId: currentSavedId || null
        }));

        if (keepAlive) clearInterval(keepAlive);
        keepAlive = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25000);
      };

      ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          const cb = callbacksRef.current;
          
          // Notify external subscribers (e.g., CLI transfer panel)
          wsListenersRef.current.forEach((listener) => {
            try { listener(data); } catch (err) { console.error('Error in WS subscriber:', err); }
          });
          
          switch (data.type) {
            case 'registered':
              if (data.success) {
                setLocalId(data.peerId);
                localIdRef.current = data.peerId;
                try {
                  sessionStorage.setItem('airlink_client_id', data.peerId);
                  localStorage.setItem('airlink_client_id', data.peerId);
                } catch (e) {}

                if (data.lanIp && data.port) {
                  setLanUrl(`http://${data.lanIp}:${data.port}`);
                }

                // Check for QR scan auto-connect intent
                const pendingTarget = autoConnectTargetRef.current;
                if (pendingTarget && pendingTarget !== data.peerId) {
                  autoConnectTargetRef.current = null;
                  cb.showToast?.('QR Scan Detected', `Auto-linking to Desk ${pendingTarget}...`, 'info');
                  
                  // Clean URL bar query params without page reload
                  try {
                    const currentUrl = new URL(window.location.href);
                    currentUrl.searchParams.delete('connect');
                    currentUrl.searchParams.delete('desk');
                    window.history.replaceState({}, document.title, currentUrl.pathname + (currentUrl.search ? currentUrl.search : ''));
                  } catch (e) {}

                  // Connect to remote target
                  setTimeout(() => {
                    cb.connectToRemote?.(pendingTarget);
                  }, 400);
                }
              }
              break;

            case 'connect-failed':
              setIsConnecting(false);
              cb.showToast?.('Connection Refused', data.reason, 'error');
              cb.disconnectSession?.();
              break;

            case 'connect-approved':
              connectionDirectionRef.current = 'sender';
              activePeerIdRef.current = data.targetId;
              cb.showToast?.('Connection Approved', 'Linking P2P lines...', 'info');
              cb.initiateWebRTCLink?.(data.targetId);
              break;

            case 'peer-linking':
              connectionDirectionRef.current = 'receiver';
              activePeerIdRef.current = data.senderId;
              cb.showToast?.('Incoming Desk Link', `Peer ${data.senderId} connecting...`, 'info');
              break;

            case 'signal-relay':
              cb.handleSignalingSignal?.(data.senderId, data.payload);
              break;

            case 'peer-offline':
              cb.showToast?.('Handshake Failed', `Remote Desk went offline.`, 'error');
              cb.disconnectSession?.();
              break;

            case 'peer-disconnected':
              if (activePeerIdRef.current === data.peerId) {
                cb.showToast?.('Desk Offline', 'Direct session connection severed by remote.', 'error');
                cb.disconnectSession?.();
              }
              break;
              
            default:
              break;
          }
        } catch (e) {
          console.error('Error processing server event:', e);
        }
      };

      ws.onclose = (event) => {
        setServerConnected(false);
        if (keepAlive) clearInterval(keepAlive);
        if (!isUnmounted) {
          if (event && event.code === 1008) {
            console.warn('WebSocket throttled by server. Backing off reconnect.');
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(connect, 15000); // 15s backoff
            return;
          }
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connect, 5000); // retry reconnect
        }
      };

      ws.onerror = (err) => {
        console.warn('WebSocket encountered error:', err);
      };
    }

    connect();

    return () => {
      isUnmounted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (keepAlive) clearInterval(keepAlive);
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        try {
          ws.close();
        } catch (e) {}
      }
      wsRef.current = null;
    };
  }, []);

  return {
    localId,
    serverConnected,
    activePeerId,
    isWorkspaceOpen,
    isConnecting,
    latency,
    chatMessages,
    activeTransfers,
    toasts,
    lanUrl,
    initialConnectId,
    
    connectToRemote,
    sendChatMessage,
    streamFile,
    disconnectSession,
    removeToast,
    setActiveTransfers,
    showToast,
    addWsListener,
    sendWsMessage,
    getWsBufferedAmount
  };
}
