import React, { useState } from 'react';
import { useWebRTC } from './hooks/useWebRTC';
import Header from './components/Header';
import IdentityPanel from './components/IdentityPanel';
import ConnectionPanel from './components/ConnectionPanel';
import TransferWorkspace from './components/TransferWorkspace';
import ToastContainer from './components/ToastContainer';
import CliTransferPanel from './components/CliTransferPanel';
import SeoContentSection from './components/SeoContentSection';

export default function App() {
  const [showCliTransfer, setShowCliTransfer] = useState(false);
  
  const {
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
  } = useWebRTC();

  return (
    <div className="app-container">
      {/* Header */}
      <Header serverConnected={serverConnected} />

      {/* Main P2P Workspace Area */}
      <main className="dashboard-grid">
        {!isWorkspaceOpen ? (
          <>
            <IdentityPanel 
              localId={localId} 
              lanUrl={lanUrl}
              showToast={showToast} 
            />
            <ConnectionPanel 
              connectToRemote={connectToRemote} 
              isConnecting={isConnecting} 
              initialConnectId={initialConnectId}
            />
          </>
        ) : (
          <TransferWorkspace 
            activePeerId={activePeerId}
            latency={latency}
            disconnectSession={disconnectSession}
            streamFile={streamFile}
            activeTransfers={activeTransfers}
            setActiveTransfers={setActiveTransfers}
            chatMessages={chatMessages}
            sendChatMessage={sendChatMessage}
          />
        )}
      </main>

      {/* Terminal Transfer Feature (Minimal Dropdown Block) */}
      {!isWorkspaceOpen && (
        <section className="terminal-feature-block">
          <button
            type="button"
            className={`terminal-dropdown-btn ${showCliTransfer ? 'active' : ''}`}
            onClick={() => setShowCliTransfer(prev => !prev)}
            aria-expanded={showCliTransfer}
          >
            <div className="terminal-dropdown-left">
              <span className="terminal-code-icon">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="4 17 10 11 4 5" />
                  <line x1="12" y1="19" x2="20" y2="19" />
                </svg>
              </span>
              <span className="terminal-dropdown-title">Terminal File Transfer</span>
              <span className="terminal-dropdown-badge">cURL</span>
            </div>
            <div className="terminal-dropdown-right">
              <span className="terminal-dropdown-hint">Send to remote server or terminal</span>
              <svg 
                className={`terminal-dropdown-chevron ${showCliTransfer ? 'open' : ''}`}
                width="16" 
                height="16" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="2"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          </button>

          {showCliTransfer && (
            <div className="terminal-dropdown-content">
              <CliTransferPanel 
                serverConnected={serverConnected}
                lanUrl={lanUrl}
                showToast={showToast}
                addWsListener={addWsListener}
                sendWsMessage={sendWsMessage}
                getWsBufferedAmount={getWsBufferedAmount}
              />
            </div>
          )}
        </section>
      )}

      {/* SEO Informational & FAQ Section */}
      {!isWorkspaceOpen && <SeoContentSection />}

      {/* Footer */}
      <footer className="app-footer">
        <div className="footer-status-pills">
          <div className="footer-status-pill">
            <span className="dot-indicator green"></span>
            <span>End-to-End Encrypted</span>
          </div>
          <span className="footer-divider">•</span>
          <div className="footer-status-pill">
            <span>Direct P2P (WebRTC)</span>
          </div>
          <span className="footer-divider">•</span>
          <div className="footer-status-pill">
            <span>Zero Cloud Storage</span>
          </div>
        </div>
        <div className="footer-credits">
          <span>AirLink &bull; P2P File Sharing by <a href="https://iamrahulshaw.in/" target="_blank" rel="noopener noreferrer">Rahul Shaw</a></span>
        </div>
      </footer>

      {/* Floating notifications */}
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  );
}
