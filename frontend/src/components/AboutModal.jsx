export default function AboutModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="modal-backdrop fade-in" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-dialog content-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "560px" }}>
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span className="brand-disc" />
            <h3 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 800, letterSpacing: "-0.02em" }}>
              About TOGETHER
            </h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>

        <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: "18px", fontSize: "0.92rem", lineHeight: 1.6 }}>
          <div style={{
            padding: "16px",
            background: "linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(6, 182, 212, 0.08) 100%)",
            border: "1px solid rgba(16, 185, 129, 0.2)",
            borderRadius: "var(--radius-control)"
          }}>
            <p style={{ margin: 0, fontWeight: 600, color: "var(--text-main)", fontSize: "1rem" }}>
              "What if sharing what you hear were as easy as sharing what you see?"
            </p>
          </div>

          <p className="subtle-text" style={{ margin: 0 }}>
            <strong>TOGETHER</strong> is a browser-first audio-sharing and synchronized listening stage.
            It allows friends, study groups, classrooms, and creators to broadcast music, lectures, tabs, and voice directly over real-time WebRTC — without video call overhead, mandatory app downloads, or complex account barriers.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <h4 style={{ margin: "0 0 4px", fontSize: "0.95rem", fontWeight: 700 }}>Key Capabilities</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", fontSize: "0.84rem" }}>
              <div className="about-pill">🎧 Multi-Source Studio Mixer</div>
              <div className="about-pill">⚡ Direct WebRTC SRTP Audio</div>
              <div className="about-pill">🔋 Screen-Locked Background Audio</div>
              <div className="about-pill">📱 QR Scan Instant Join</div>
              <div className="about-pill">💬 Real-Time Live Chat & Reactions</div>
              <div className="about-pill">🎙️ Live Speech-to-Text Transcripts</div>
            </div>
          </div>

          <div style={{
            marginTop: "10px",
            paddingTop: "16px",
            borderTop: "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between"
          }}>
            <div>
              <span className="subtle-text" style={{ fontSize: "0.8rem", display: "block" }}>Crafted & Engineered with Pride</span>
              <span style={{
                fontFamily: "monospace",
                fontWeight: 800,
                fontSize: "1.05rem",
                letterSpacing: "0.1em",
                color: "var(--accent-primary)"
              }}>
                S_/_/
              </span>
            </div>
            <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>TOGETHER v2.0 Production</span>
          </div>
        </div>

        <div className="modal-footer" style={{ marginTop: "20px", display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="button-primary" onClick={onClose} style={{ padding: "8px 20px" }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
