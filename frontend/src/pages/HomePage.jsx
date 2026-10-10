import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";

export default function HomePage() {
  const navigate = useNavigate();
  const [hostName, setHostName] = useState("");
  const [audioSource, setAudioSource] = useState("microphone");
  const [joinRoomCode, setJoinRoomCode] = useState("");
  const [joinError, setJoinError] = useState("");

  function handleHostStart(e) {
    e.preventDefault();
    const nameParam = hostName.trim() ? encodeURIComponent(hostName.trim()) : "Host";
    navigate(`/host?name=${nameParam}&source=${audioSource}`);
  }

  function handleJoinSubmit(e) {
    e.preventDefault();
    const code = joinRoomCode.trim().toUpperCase();
    if (!code) {
      setJoinError("Enter a room station code.");
      return;
    }
    const normalized = code.startsWith("ROOM-") ? code : `ROOM-${code}`;
    navigate(`/join/${normalized}`);
  }

  return (
    <AppShell>
      {/* Hero Presentation */}
      <section className="fade-in" style={{ textAlign: "center", padding: "24px 0 36px" }}>
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          background: "rgba(16, 185, 129, 0.1)",
          border: "1px solid rgba(16, 185, 129, 0.3)",
          color: "var(--accent-primary)",
          padding: "6px 16px",
          borderRadius: "999px",
          fontSize: "0.8rem",
          fontWeight: 700,
          letterSpacing: "0.08em",
          marginBottom: "18px"
        }}>
          <span className="live-indicator-dot" />
          <span>REAL-TIME MULTI-USER AUDIO STREAMING</span>
        </div>

        <h1 style={{
          fontSize: "clamp(2.4rem, 5vw, 3.8rem)",
          fontWeight: 800,
          lineHeight: 1.12,
          letterSpacing: "-0.03em",
          marginBottom: "16px",
          maxWidth: "850px",
          margin: "0 auto 16px"
        }}>
          Stream live audio. <br />
          <span style={{
            background: "linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-cyan) 50%, var(--accent-violet) 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent"
          }}>
            Everyone tunes in together.
          </span>
        </h1>

        <p className="subtle-text" style={{
          fontSize: "1.1rem",
          maxWidth: "600px",
          margin: "0 auto 28px",
          lineHeight: 1.6
        }}>
          One host broadcasts device audio, YouTube, Spotify, or microphone.
          Nearby listeners join instantly with a QR scan or station code.
        </p>

        {/* Animated equalizer waves */}
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "5px", height: "32px", marginBottom: "36px" }}>
          {[12, 24, 18, 30, 16, 26, 32, 20, 14, 28, 22, 16, 30, 20, 12].map((height, i) => (
            <div
              key={i}
              style={{
                width: "4px",
                height: `${height}px`,
                background: "linear-gradient(to top, var(--accent-primary), var(--accent-cyan))",
                borderRadius: "2px",
                animation: `eqPulse 1.2s infinite ease-in-out alternate`,
                animationDelay: `${i * 0.08}s`
              }}
            />
          ))}
        </div>
      </section>

      {/* Main Action Cards (Spotify / JioSaavn Style) */}
      <section style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
        gap: "24px",
        marginBottom: "40px"
      }}>
        {/* Host Station Card */}
        <div className="content-card fade-in" style={{ padding: "32px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{
                width: "44px",
                height: "44px",
                borderRadius: "12px",
                background: "rgba(16, 185, 129, 0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.4rem"
              }}>
                🎙️
              </div>
              <div>
                <h2 style={{ fontSize: "1.35rem", fontWeight: 700, margin: 0 }}>Host Broadcast</h2>
                <span className="subtle-text" style={{ fontSize: "0.82rem" }}>Go live and share audio</span>
              </div>
            </div>
            <span style={{
              fontSize: "0.75rem",
              fontWeight: 700,
              padding: "4px 10px",
              borderRadius: "999px",
              background: "rgba(255,255,255,0.06)",
              color: "var(--accent-primary)"
            }}>
              STUDIO
            </span>
          </div>

          <form onSubmit={handleHostStart} style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            <label className="field-block">
              <span className="field-label">Host Display Name</span>
              <input
                type="text"
                placeholder="e.g. Host / DJ"
                value={hostName}
                onChange={(e) => setHostName(e.target.value)}
                maxLength={30}
                className="text-input"
              />
            </label>

            <div className="field-block">
              <span className="field-label">Audio Source</span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", marginTop: "4px" }}>
                <button
                  type="button"
                  className={`button-secondary ${audioSource === "microphone" ? "active-pill" : ""}`}
                  onClick={() => setAudioSource("microphone")}
                  style={{ padding: "10px 6px", fontSize: "0.85rem" }}
                >
                  🎤 Mic
                </button>
                <button
                  type="button"
                  className={`button-secondary ${audioSource === "device-audio" ? "active-pill" : ""}`}
                  onClick={() => setAudioSource("device-audio")}
                  style={{ padding: "10px 6px", fontSize: "0.85rem" }}
                >
                  💻 Apps/Tab
                </button>
                <button
                  type="button"
                  className={`button-secondary ${audioSource === "audio-file" ? "active-pill" : ""}`}
                  onClick={() => setAudioSource("audio-file")}
                  style={{ padding: "10px 6px", fontSize: "0.85rem" }}
                >
                  📁 File
                </button>
              </div>
            </div>

            <button type="submit" className="button-primary" style={{ marginTop: "8px", width: "100%", padding: "14px" }}>
              Launch Broadcast Studio &rarr;
            </button>
          </form>
        </div>

        {/* Tune In Card */}
        <div className="content-card fade-in" style={{ padding: "32px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{
                width: "44px",
                height: "44px",
                borderRadius: "12px",
                background: "rgba(6, 182, 212, 0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.4rem"
              }}>
                🎧
              </div>
              <div>
                <h2 style={{ fontSize: "1.35rem", fontWeight: 700, margin: 0 }}>Tune In & Listen</h2>
                <span className="subtle-text" style={{ fontSize: "0.82rem" }}>Join an active frequency</span>
              </div>
            </div>
            <span style={{
              fontSize: "0.75rem",
              fontWeight: 700,
              padding: "4px 10px",
              borderRadius: "999px",
              background: "rgba(255,255,255,0.06)",
              color: "var(--accent-cyan)"
            }}>
              LISTENER
            </span>
          </div>

          <form onSubmit={handleJoinSubmit} style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            <label className="field-block">
              <span className="field-label">Room / Station Code</span>
              <input
                type="text"
                placeholder="e.g. AX27"
                value={joinRoomCode}
                onChange={(e) => {
                  setJoinRoomCode(e.target.value.toUpperCase());
                  setJoinError("");
                }}
                maxLength={12}
                className="text-input"
                style={{ textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, fontSize: "1.1rem" }}
              />
            </label>

            {joinError && (
              <p style={{ color: "var(--accent-rose)", fontSize: "0.85rem", margin: 0 }}>{joinError}</p>
            )}

            <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
              <button type="submit" className="button-primary" style={{ flex: 1, padding: "14px" }}>
                Tune In
              </button>
              <Link to="/join" className="button-secondary" style={{ flex: 1, padding: "14px" }}>
                📷 Scan QR
              </Link>
            </div>
          </form>
        </div>
      </section>

      {/* Enterprise Feature Banner */}
      <section style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-around",
        flexWrap: "wrap",
        gap: "16px",
        padding: "18px 24px",
        background: "rgba(255, 255, 255, 0.03)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-card)",
        fontSize: "0.82rem",
        fontWeight: 600,
        letterSpacing: "0.06em",
        color: "var(--text-secondary)"
      }}>
        <span>⚡ WEBRTC DIRECT STREAMING</span>
        <span>•</span>
        <span>🎵 LOSSLESS 48KHZ STEREO</span>
        <span>•</span>
        <span>📱 QR SCAN TO TUNE IN</span>
        <span>•</span>
        <span>🔋 BACKGROUND & LOCK-SCREEN ACTIVE</span>
      </section>
    </AppShell>
  );
}
