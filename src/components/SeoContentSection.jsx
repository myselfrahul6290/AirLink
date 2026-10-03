import React, { useState } from 'react';

const FAQS = [
  {
    question: "How does browser-to-browser P2P transfer work?",
    answer: "AirLink connects two browsers directly using WebRTC DataChannels. Once you exchange the 6-digit Desk ID or scan the QR code, data flows directly device-to-device through an end-to-end encrypted peer connection without touching any cloud storage."
  },
  {
    question: "How does the Terminal transfer feature work?",
    answer: "When you select a file and run the generated curl command on your Linux, Mac, or Windows terminal, an HTTP streaming pipe connects directly to your open browser tab. Your browser streams the file chunks in real time — zero bytes are ever written to server disk."
  },
  {
    question: "Is my data safe and private?",
    answer: "Yes. All browser-to-browser transfers use native WebRTC DTLS and SRTP encryption. In terminal transfers, files reside in your local browser memory until piped into your terminal. No files or chat messages are logged or stored."
  },
  {
    question: "Are there any file size limits?",
    answer: "No. Because files stream directly in memory buffers rather than uploading to cloud storage, you can transfer files of any size — photos, large 4K videos, disk images, or source code archives."
  },
  {
    question: "Do I need to be on the same Wi-Fi network?",
    answer: "No. AirLink works across different Wi-Fi networks, mobile data (4G/5G), and across the internet using standard WebRTC STUN signaling."
  },
  {
    question: "Do I need to install any software or extensions?",
    answer: "No. AirLink runs natively inside modern web browsers (Chrome, Safari, Firefox, Edge) on phones, tablets, and computers, and requires only standard curl on terminal machines."
  }
];

export default function SeoContentSection() {
  const [openFaq, setOpenFaq] = useState(null);

  const toggleFaq = (idx) => {
    setOpenFaq(prev => prev === idx ? null : idx);
  };

  return (
    <section className="seo-section" aria-label="About AirLink Transfer Methods">
      {/* What is AirLink Intro Card */}
      <div className="seo-about-card">
        <h3 className="seo-section-title">What is AirLink?</h3>
        <p className="seo-about-desc">
          AirLink is a private, peer-to-peer (WebRTC) browser tool for instant file sharing and text messaging using a 6-digit code or QR code—with zero sign-ups or cloud storage.
        </p>
        <p className="seo-about-desc secondary">
          Need to send files to a server? Use the <strong>Terminal File Transfer</strong> option to stream files straight into any command line using a simple <code className="seo-inline-code">cURL</code> command.
        </p>
      </div>

      {/* Unified 2-Way Transfer Comparison */}
      <div className="seo-methods-container">
        <h3 className="seo-section-title">Two Ways to Transfer</h3>
        
        <div className="seo-methods-grid">
          {/* Method 1: Browser P2P */}
          <div className="seo-method-card">
            <div className="seo-method-header">
              <div className="seo-method-icon p2p">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              </div>
              <div className="seo-method-title">
                <h4>Browser to Browser</h4>
                <span>WebRTC DataChannel</span>
              </div>
            </div>

            <p className="seo-method-desc">
              Direct device-to-device transfer between two browsers. Perfect for phone-to-PC, laptop-to-phone, or coworker sharing.
            </p>

            <div className="seo-method-steps">
              <div className="seo-method-step">
                <span className="method-step-num">1</span>
                <p>Share your <strong>6-digit Desk ID</strong> or show your QR code.</p>
              </div>
              <div className="seo-method-step">
                <span className="method-step-num">2</span>
                <p>Enter the code on the remote device to connect instantly.</p>
              </div>
              <div className="seo-method-step">
                <span className="method-step-num">3</span>
                <p>Drag &amp; drop files of any size with encrypted live chat.</p>
              </div>
            </div>
          </div>

          {/* Method 2: Browser to Terminal */}
          <div className="seo-method-card">
            <div className="seo-method-header">
              <div className="seo-method-icon cli">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="4 17 10 11 4 5" />
                  <line x1="12" y1="19" x2="20" y2="19" />
                </svg>
              </div>
              <div className="seo-method-title">
                <h4>Browser to Terminal</h4>
                <span>Direct cURL Stream</span>
              </div>
            </div>

            <p className="seo-method-desc">
              Stream files straight into headless Linux servers, Raspberry Pis, or local terminals without needing a browser on the receiving end.
            </p>

            <div className="seo-method-steps">
              <div className="seo-method-step">
                <span className="method-step-num">1</span>
                <p>Switch to the <strong>Send to Terminal</strong> tab above and pick your file.</p>
              </div>
              <div className="seo-method-step">
                <span className="method-step-num">2</span>
                <p>Select your OS (<strong>Linux</strong>, <strong>Mac</strong>, or <strong>Windows</strong>) and copy the command.</p>
              </div>
              <div className="seo-method-step">
                <span className="method-step-num">3</span>
                <p>Paste into your terminal. The file pipes straight into your directory.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Core Privacy & Speed Highlights */}
      <div className="seo-features">
        <h3 className="seo-section-title">Built for Privacy &amp; Speed</h3>
        <div className="features-grid">
          <div className="feature-item">
            <span className="feature-icon">🔒</span>
            <div className="feature-text">
              <h4>Zero Cloud Storage</h4>
              <p>Files stream in live memory buffers. Zero bytes are stored on server disks.</p>
            </div>
          </div>
          <div className="feature-item">
            <span className="feature-icon">⚡</span>
            <div className="feature-text">
              <h4>No File Size Limits</h4>
              <p>Transfer multi-gigabyte videos, archives, or disk images with zero throttling.</p>
            </div>
          </div>
          <div className="feature-item">
            <span className="feature-icon">🛡️</span>
            <div className="feature-text">
              <h4>End-to-End Encrypted</h4>
              <p>Native WebRTC DTLS/SRTP cryptography protects all direct peer transfers.</p>
            </div>
          </div>
          <div className="feature-item">
            <span className="feature-icon">🌐</span>
            <div className="feature-text">
              <h4>No Software to Install</h4>
              <p>Runs in any web browser and downloads to any terminal with cURL.</p>
            </div>
          </div>
        </div>
      </div>

      {/* FAQ Accordion */}
      <div className="seo-faq">
        <h3 className="seo-section-title">Frequently Asked Questions</h3>
        <div className="faq-list">
          {FAQS.map((faq, idx) => {
            const isOpen = openFaq === idx;
            return (
              <div key={idx} className={`faq-item ${isOpen ? 'open' : ''}`}>
                <button 
                  type="button"
                  className="faq-question-btn"
                  onClick={() => toggleFaq(idx)}
                  aria-expanded={isOpen}
                >
                  <span>{faq.question}</span>
                  <span className={`faq-arrow ${isOpen ? 'rotated' : ''}`}>▼</span>
                </button>
                {isOpen && (
                  <div className="faq-answer">
                    <p>{faq.answer}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
