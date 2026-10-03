import React, { useState, useEffect, useRef, useCallback } from 'react';

export default function CliTransferPanel({
  serverConnected,
  lanUrl,
  showToast,
  addWsListener,
  sendWsMessage
}) {
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [cliSession, setCliSession] = useState(null);
  const [copied, setCopied] = useState(false);
  const [osTab, setOsTab] = useState('linux'); // 'linux' | 'mac' | 'windows'

  // Transfer lifecycle: 'idle' | 'waiting' | 'streaming' | 'completed' | 'error'
  const [transferStatus, setTransferStatus] = useState('idle');
  const [progress, setProgress] = useState({
    percent: 0,
    loaded: 0,
    total: 0,
    speedText: '0 KB/s',
    etaText: '--'
  });

  const fileInputRef = useRef(null);
  const xhrRef = useRef(null);
  const pollTimerRef = useRef(null);
  const isStreamingRef = useRef(false);

  // Automatically determine base origin (uses LAN URL if on localhost so external terminals can connect, else current origin)
  const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const baseOrigin = isLocal ? (lanUrl || window.location.origin) : (typeof window !== 'undefined' ? window.location.origin : '');
  const downloadUrl = (cliSession && baseOrigin) ? `${baseOrigin}/d/${cliSession.code}` : '';
  
  const getCommand = () => {
    if (!downloadUrl) return '';
    switch (osTab) {
      case 'windows':
        return `curl.exe -OJ "${downloadUrl}"`;
      case 'mac':
        return `curl -OJ "${downloadUrl}"`;
      case 'linux':
      default:
        return `curl -OJ ${downloadUrl}`;
    }
  };
  const commandStr = getCommand();

  // Format helper for bytes
  const formatBytes = (bytes, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  // Format helper for seconds ETA
  const formatEta = (seconds) => {
    if (!seconds || !isFinite(seconds) || seconds <= 0) return '0s';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
  };

  // Trigger streaming upload ONLY when the terminal receiver connects
  const startStreamingUpload = useCallback((session, fileToUpload) => {
    if (isStreamingRef.current) return;
    isStreamingRef.current = true;
    setTransferStatus('streaming');

    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    const startTime = Date.now();
    let lastLoaded = 0;
    let lastTime = startTime;
    const speedSamples = [];

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const now = Date.now();
        const timeDelta = (now - lastTime) / 1000;

        if (timeDelta >= 0.25) {
          const bytesDelta = e.loaded - lastLoaded;
          const currentSpeed = bytesDelta / timeDelta;
          speedSamples.push(currentSpeed);
          if (speedSamples.length > 5) speedSamples.shift();

          const avgSpeed = speedSamples.reduce((a, b) => a + b, 0) / speedSamples.length;
          const remainingBytes = e.total - e.loaded;
          const etaSecs = avgSpeed > 0 ? remainingBytes / avgSpeed : 0;
          const percent = Math.min(Math.round((e.loaded / e.total) * 100), 100);

          setProgress({
            percent,
            loaded: e.loaded,
            total: e.total,
            speedText: formatBytes(avgSpeed) + '/s',
            etaText: formatEta(etaSecs)
          });

          lastLoaded = e.loaded;
          lastTime = now;
        }
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setProgress((prev) => ({
          ...prev,
          percent: 100,
          loaded: fileToUpload.size,
          speedText: 'Complete',
          etaText: '0s'
        }));
        setTransferStatus('completed');
        isStreamingRef.current = false;
        showToast?.('Transfer Complete', `${fileToUpload.name} streamed directly to terminal!`, 'success');
      } else {
        setTransferStatus('error');
        isStreamingRef.current = false;
        showToast?.('Transfer Failed', `Upload failed with status ${xhr.status}`, 'error');
      }
    };

    xhr.onerror = () => {
      setTransferStatus('error');
      isStreamingRef.current = false;
      showToast?.('Transfer Interrupted', 'Connection to server interrupted.', 'error');
    };

    xhr.onabort = () => {
      isStreamingRef.current = false;
      setTransferStatus('error');
    };

    xhr.open('POST', `/api/cli-upload/${session.code}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.send(fileToUpload);
  }, [showToast]);

  // Register file metadata only (file data stays in browser memory until terminal connects)
  const handleRegisterFile = async (selectedFile) => {
    if (!selectedFile) return;
    setFile(selectedFile);
    setTransferStatus('waiting');
    setProgress({
      percent: 0,
      loaded: 0,
      total: selectedFile.size,
      speedText: '0 KB/s',
      etaText: '--'
    });
    isStreamingRef.current = false;

    try {
      // Only metadata is sent to get a 6-digit short code. File is NOT uploaded here!
      const response = await fetch('/api/cli-share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: selectedFile.name,
          size: selectedFile.size,
          mimeType: selectedFile.type
        })
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const sessionData = await response.json();
      setCliSession(sessionData);

      // Bind WebSocket to token so server knows when terminal connects
      sendWsMessage?.({
        type: 'cli-bind-token',
        code: sessionData.code
      });

      showToast?.('Command Ready', `Short code #${sessionData.code} reserved. Run curl in your terminal!`, 'info');
    } catch (err) {
      console.error('Failed to create CLI share:', err);
      showToast?.('Registration Failed', 'Could not create transfer slot on server.', 'error');
      setTransferStatus('idle');
      setFile(null);
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleRegisterFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInputChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleRegisterFile(e.target.files[0]);
      e.target.value = '';
    }
  };

  // Listen for terminal connection event from server
  useEffect(() => {
    if (!cliSession || !addWsListener) return;

    const unbind = addWsListener((data) => {
      if (data.type === 'cli-receiver-connected' && data.code === cliSession.code) {
        showToast?.('Terminal Connected', 'Receiver connected! Transfer started...', 'info');
        if (file) {
          startStreamingUpload(cliSession, file);
        }
      } else if (data.type === 'cli-receiver-disconnected' && data.code === cliSession.code) {
        if (isStreamingRef.current) {
          if (xhrRef.current) xhrRef.current.abort();
          isStreamingRef.current = false;
          setTransferStatus('error');
          showToast?.('Terminal Disconnected', 'Receiver closed connection prematurely.', 'error');
        }
      }
    });

    return () => {
      unbind();
    };
  }, [cliSession, file, addWsListener, startStreamingUpload, showToast]);

  // Fallback status check while waiting
  useEffect(() => {
    if (!cliSession || transferStatus !== 'waiting') {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    pollTimerRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/cli-status/${cliSession.code}`);
        if (res.ok) {
          const statusData = await res.json();
          if (statusData.hasReceiver && !isStreamingRef.current && file) {
            startStreamingUpload(cliSession, file);
          }
        }
      } catch (e) {
        // Polling error ignored
      }
    }, 1200);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [cliSession, transferStatus, file, startStreamingUpload]);

  // Copy command to clipboard
  const handleCopyCommand = () => {
    if (!commandStr) return;

    navigator.clipboard.writeText(commandStr).then(() => {
      setCopied(true);
      showToast?.('Command Copied', 'Paste into your terminal to start transfer.', 'success');
      setTimeout(() => setCopied(false), 2200);
    });
  };

  // Reset / Send another file
  const handleReset = () => {
    if (xhrRef.current) {
      try { xhrRef.current.abort(); } catch (e) {}
    }
    if (cliSession) {
      fetch(`/api/cli-cancel/${cliSession.code}`, { method: 'DELETE' }).catch(() => {});
    }
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    isStreamingRef.current = false;
    setFile(null);
    setCliSession(null);
    setTransferStatus('idle');
    setProgress({ percent: 0, loaded: 0, total: 0, speedText: '0 KB/s', etaText: '--' });
  };

  return (
    <div className="cli-transfer-container">
      <div className="cli-main-panel">
        {transferStatus === 'idle' ? (
          /* STEP 1: DROPZONE */
          <div
            className={`cli-dropzone ${dragOver ? 'drag-over' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current && fileInputRef.current.click()}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileInputChange}
              style={{ display: 'none' }}
            />
            <div className="cli-dropzone-icon-wrapper">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <h3>Drop any file to generate terminal command</h3>
            <p className="cli-dropzone-subtitle">
              or <span className="browse-link">click to browse</span>
            </p>
            <div className="cli-dropzone-badges">
              <span className="cli-badge">Zero Server Disk</span>
              <span className="cli-badge">Direct RAM Stream</span>
              <span className="cli-badge">curl &bull; wget</span>
            </div>
          </div>
        ) : (
          /* STEP 2: ACTIVE COMMAND & LIVE PROGRESS */
          <div className="cli-active-session">
            {/* File Info Bar */}
            <div className="cli-file-summary-card">
              <div className="cli-file-meta">
                <div className="cli-file-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                </div>
                <div className="cli-file-text">
                  <div className="cli-file-name" title={file?.name}>
                    {file?.name}
                  </div>
                  <div className="cli-file-sub">
                    <span>{formatBytes(file?.size || 0)}</span>
                    <span className="cli-dot">•</span>
                    <span className="cli-code-tag">Slot #{cliSession?.formattedCode || cliSession?.code}</span>
                  </div>
                </div>
              </div>

              <div className="cli-file-actions">
                <button
                  className="cli-btn-secondary"
                  onClick={handleReset}
                  title="Choose a different file"
                >
                  {transferStatus === 'completed' ? '✨ Send Another File' : 'Cancel & Change File'}
                </button>
              </div>
            </div>

            {/* OS Selection & cURL Command */}
            <div className="cli-command-section">
              <div className="cli-section-header">
                <div className="cli-os-tabs">
                  <button
                    type="button"
                    className={`cli-os-tab ${osTab === 'linux' ? 'active' : ''}`}
                    onClick={() => setOsTab('linux')}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="4 17 10 11 4 5" />
                      <line x1="12" y1="19" x2="20" y2="19" />
                    </svg>
                    <span>Linux</span>
                  </button>
                  <button
                    type="button"
                    className={`cli-os-tab ${osTab === 'mac' ? 'active' : ''}`}
                    onClick={() => setOsTab('mac')}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.37c.63-.78 1.07-1.86.95-2.95-1 .04-2.14.65-2.77 1.43-.57.67-.99 1.77-.86 2.83 1.1.08 2.1-.57 2.68-1.31z" />
                    </svg>
                    <span>Mac</span>
                  </button>
                  <button
                    type="button"
                    className={`cli-os-tab ${osTab === 'windows' ? 'active' : ''}`}
                    onClick={() => setOsTab('windows')}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="8" height="8" rx="1" />
                      <rect x="13" y="3" width="8" height="8" rx="1" />
                      <rect x="3" y="13" width="8" height="8" rx="1" />
                      <rect x="13" y="13" width="8" height="8" rx="1" />
                    </svg>
                    <span>Windows</span>
                  </button>
                </div>
              </div>

              {/* Command Code Box */}
              <div className="cli-code-box">
                <div className="cli-code-text">
                  <span className="cli-prompt-symbol">$</span>
                  <code>{commandStr}</code>
                </div>
                <button
                  type="button"
                  className={`cli-copy-btn ${copied ? 'copied' : ''}`}
                  onClick={handleCopyCommand}
                >
                  {copied ? (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Minimal Live Status Widget */}
            <div className="cli-status-card">
              {transferStatus === 'waiting' && (
                <div className="cli-status-waiting">
                  <div className="cli-status-spinner"></div>
                  <div className="cli-status-text">
                    <span className="cli-status-title">Waiting for terminal connection</span>
                    <span className="cli-status-sub">Run the curl command above in your {osTab === 'windows' ? 'PowerShell / Terminal' : 'terminal'} to start instant stream.</span>
                  </div>
                </div>
              )}

              {transferStatus === 'streaming' && (
                <div className="cli-status-streaming">
                  <div className="cli-streaming-header">
                    <div className="cli-streaming-badge">
                      <span className="streaming-pulse-dot"></span>
                      <span>Streaming ({progress.percent}%)</span>
                    </div>
                    <div className="cli-streaming-meta">
                      <span>{formatBytes(progress.loaded)} / {formatBytes(progress.total)}</span>
                      <span className="cli-dot">•</span>
                      <span>{progress.speedText}</span>
                      <span className="cli-dot">•</span>
                      <span>ETA: {progress.etaText}</span>
                    </div>
                  </div>
                  <div className="cli-progress-bar-bg">
                    <div 
                      className="cli-progress-bar-fill" 
                      style={{ width: `${progress.percent}%` }}
                    ></div>
                  </div>
                </div>
              )}

              {transferStatus === 'completed' && (
                <div className="cli-status-completed">
                  <div className="cli-completed-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <div className="cli-status-text">
                    <span className="cli-status-title">File transferred successfully!</span>
                    <span className="cli-status-sub">Saved in receiver terminal's working directory.</span>
                  </div>
                  <button
                    type="button"
                    className="cli-btn-action"
                    onClick={handleReset}
                  >
                    Send Another File
                  </button>
                </div>
              )}

              {transferStatus === 'error' && (
                <div className="cli-status-error">
                  <span className="cli-error-badge">⚠️ Interrupted</span>
                  <span className="cli-status-sub">Connection closed or cancelled before completion.</span>
                  <button
                    type="button"
                    className="cli-btn-action"
                    onClick={handleReset}
                  >
                    Reset
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
