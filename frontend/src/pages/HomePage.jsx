import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import { fetchPublicRooms } from "../lib/api";

const PRESET_MODES = [
  { id: "music", label: "🎵 Music & Party", title: "Live Music Session", cat: "Music" },
  { id: "study", label: "📚 Study & Focus", title: "Group Study & Lo-Fi Focus", cat: "Study" },
  { id: "lecture", label: "🎓 Class Lecture", title: "Live Classroom Lecture", cat: "Lecture" },
  { id: "podcast", label: "🎙️ Podcast / Talk", title: "Audio Discussion Stage", cat: "Podcast" },
  { id: "dj", label: "🎛️ DJ Live Stage", title: "DJ Pulse Live Mix", cat: "DJ" }
];

export default function HomePage() {
  const navigate = useNavigate();
  const [hostName, setHostName] = useState("");
  const [roomTitle, setRoomTitle] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Music");
  const [joinRoomCode, setJoinRoomCode] = useState("");
  const [joinError, setJoinError] = useState("");

  // Public active rooms discovery
  const [activeRooms, setActiveRooms] = useState([]);
  const [isLoadingRooms, setIsLoadingRooms] = useState(true);
  const [roomFilterCategory, setRoomFilterCategory] = useState("All");
  const [roomSearchQuery, setRoomSearchQuery] = useState("");

  // Recent rooms from local storage
  const [recentRooms, setRecentRooms] = useState([]);

  useEffect(() => {
    // Load recent rooms
    try {
      const saved = localStorage.getItem("together-recent-rooms");
      if (saved) {
        setRecentRooms(JSON.parse(saved).slice(0, 5));
      }
    } catch (_e) {}

    // Fetch active public rooms
    loadPublicRooms();
    const interval = setInterval(loadPublicRooms, 8000);
    return () => clearInterval(interval);
  }, []);

  function loadPublicRooms() {
    fetchPublicRooms()
      .then((data) => {
        setActiveRooms(data.rooms || []);
      })
      .catch(() => {})
      .finally(() => {
        setIsLoadingRooms(false);
      });
  }

  function handleSelectPreset(preset) {
    setSelectedCategory(preset.cat);
    setRoomTitle(preset.title);
  }

  function handleHostStart(e) {
    e.preventDefault();
    const nameParam = hostName.trim() ? encodeURIComponent(hostName.trim()) : "Host";
    const titleParam = roomTitle.trim() ? encodeURIComponent(roomTitle.trim()) : encodeURIComponent(`${nameParam}'s Room`);
    const catParam = encodeURIComponent(selectedCategory);
    navigate(`/host?name=${nameParam}&title=${titleParam}&category=${catParam}&autostart=1`);
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

  const filteredRooms = activeRooms.filter((room) => {
    const matchesCat = roomFilterCategory === "All" || room.category === roomFilterCategory;
    const query = roomSearchQuery.trim().toLowerCase();
    const matchesSearch =
      !query ||
      room.roomId.toLowerCase().includes(query) ||
      (room.title && room.title.toLowerCase().includes(query)) ||
      (room.hostName && room.hostName.toLowerCase().includes(query));
    return matchesCat && matchesSearch;
  });

  return (
    <AppShell>
      {/* Hero Presentation */}
      <section className="fade-in" style={{ textAlign: "center", padding: "20px 0 32px" }}>
        <div className="hero-pill-badge">
          <span className="live-indicator-dot" />
          <span>BROWSER-FIRST REAL-TIME AUDIO SHARING PLATFORM</span>
        </div>

        <h1 className="hero-title">
          Share what you hear. <br />
          <span className="hero-gradient-text">
            Everyone tunes in together.
          </span>
        </h1>

        <p className="hero-subtitle subtle-text">
          Zero app installations. One host streams music, lectures, Spotify, YouTube, or mic.
          Nearby listeners join in real time with high-fidelity lossless WebRTC audio.
        </p>

        {/* Animated Sound Waveform */}
        <div className="hero-waveform-bar" aria-hidden="true">
          {[14, 28, 20, 36, 18, 30, 42, 26, 16, 32, 24, 18, 34, 22, 14, 28, 38, 20, 15].map((h, i) => (
            <div
              key={i}
              className="waveform-stick"
              style={{
                height: `${h}px`,
                animationDelay: `${i * 0.07}s`
              }}
            />
          ))}
        </div>
      </section>

      {/* Main Action Grids: Broadcast Studio Launchpad & Tune-in */}
      <section className="action-cards-grid">
        {/* Host Station Card */}
        <div className="content-card fade-in" style={{ padding: "30px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div className="card-icon-bubble studio-bubble">
                🎙️
              </div>
              <div>
                <h2 style={{ fontSize: "1.35rem", fontWeight: 700, margin: 0 }}>Broadcast Studio</h2>
                <span className="subtle-text" style={{ fontSize: "0.82rem" }}>Universal multi-source audio stage</span>
              </div>
            </div>
            <span className="role-tag studio-tag">HOST</span>
          </div>

          <form onSubmit={handleHostStart} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <label className="field-block">
              <span className="field-label">Host / DJ Display Name</span>
              <input
                type="text"
                placeholder="e.g. Alex / DJ Pulse"
                value={hostName}
                onChange={(e) => setHostName(e.target.value)}
                maxLength={30}
                className="text-input"
              />
            </label>

            <label className="field-block">
              <span className="field-label">Room Topic / Session Title</span>
              <input
                type="text"
                placeholder="e.g. Late Night Chill & Lo-Fi"
                value={roomTitle}
                onChange={(e) => setRoomTitle(e.target.value)}
                maxLength={50}
                className="text-input"
              />
            </label>

            {/* Quick Presets */}
            <div>
              <span className="field-label" style={{ display: "block", marginBottom: "8px" }}>Quick Category Presets</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {PRESET_MODES.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectPreset(preset)}
                    className={`filter-chip ${selectedCategory === preset.cat ? "active" : ""}`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <button type="submit" className="button-primary" style={{ width: "100%", padding: "14px", marginTop: "6px" }}>
              Launch Studio Room &rarr;
            </button>
          </form>
        </div>

        {/* Tune In Card */}
        <div className="content-card fade-in" style={{ padding: "30px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div className="card-icon-bubble listener-bubble">
                🎧
              </div>
              <div>
                <h2 style={{ fontSize: "1.35rem", fontWeight: 700, margin: 0 }}>Tune In & Listen</h2>
                <span className="subtle-text" style={{ fontSize: "0.82rem" }}>Join an active room frequency</span>
              </div>
            </div>
            <span className="role-tag listener-tag">LISTENER</span>
          </div>

          <form onSubmit={handleJoinSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <label className="field-block">
              <span className="field-label">Room Station Code</span>
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
                style={{ textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 700, fontSize: "1.1rem" }}
              />
            </label>

            {joinError && (
              <p style={{ color: "var(--accent-rose)", fontSize: "0.85rem", margin: 0 }}>{joinError}</p>
            )}

            <div style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
              <button type="submit" className="button-primary" style={{ flex: 1, padding: "14px" }}>
                Tune In
              </button>
              <Link to="/join" className="button-secondary" style={{ flex: 1, padding: "14px" }}>
                📷 Scan QR
              </Link>
            </div>

            {/* Recent rooms quick access */}
            {recentRooms.length > 0 && (
              <div style={{ marginTop: "12px", borderTop: "1px solid var(--border-subtle)", paddingTop: "12px" }}>
                <span className="field-label" style={{ display: "block", marginBottom: "8px" }}>Recently Tuned In</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {recentRooms.map((recent) => (
                    <Link
                      key={recent.roomId}
                      to={`/listen/${recent.roomId}`}
                      className="recent-room-pill"
                    >
                      <span className="live-indicator-dot" />
                      <span>{recent.title || recent.roomId}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </form>
        </div>
      </section>

      {/* Live Discovery Directory */}
      <section className="content-card fade-in" style={{ padding: "28px", marginBottom: "36px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px", marginBottom: "20px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span className="live-indicator-dot" />
              <h2 style={{ fontSize: "1.3rem", fontWeight: 700, margin: 0 }}>Live Public Listening Stages</h2>
            </div>
            <span className="subtle-text" style={{ fontSize: "0.84rem" }}>
              Discover active broadcasts happening right now
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <input
              type="text"
              placeholder="Search rooms or hosts..."
              value={roomSearchQuery}
              onChange={(e) => setRoomSearchQuery(e.target.value)}
              className="text-input"
              style={{ fontSize: "0.85rem", padding: "8px 14px", width: "200px" }}
            />
            <button
              type="button"
              className="button-secondary"
              onClick={loadPublicRooms}
              title="Refresh live rooms"
              style={{ padding: "8px 14px", fontSize: "0.85rem" }}
            >
              🔄 Refresh
            </button>
          </div>
        </div>

        {/* Category Filter Chips */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "20px" }}>
          {["All", "Music", "Study", "Lecture", "Podcast", "DJ"].map((cat) => (
            <button
              key={cat}
              type="button"
              className={`filter-chip ${roomFilterCategory === cat ? "active" : ""}`}
              onClick={() => setRoomFilterCategory(cat)}
            >
              {cat === "All" ? "🌐 All Stations" : cat}
            </button>
          ))}
        </div>

        {/* Room Cards Grid */}
        {isLoadingRooms ? (
          <div style={{ textAlign: "center", padding: "36px" }}>
            <div className="spinner-disc" />
            <p className="subtle-text" style={{ marginTop: "12px" }}>Scanning active frequencies...</p>
          </div>
        ) : filteredRooms.length === 0 ? (
          <div style={{
            textAlign: "center",
            padding: "40px 20px",
            background: "rgba(255, 255, 255, 0.02)",
            borderRadius: "var(--radius-control)",
            border: "1px dashed var(--border-subtle)"
          }}>
            <span style={{ fontSize: "2rem", display: "block", marginBottom: "8px" }}>📻</span>
            <h3 style={{ fontSize: "1.1rem", fontWeight: 700, margin: "0 0 6px" }}>No public rooms broadcast right now</h3>
            <p className="subtle-text" style={{ fontSize: "0.88rem", maxWidth: "420px", margin: "0 auto 16px" }}>
              Be the first to create an open broadcast station! Tap Launch Studio Room above to start streaming.
            </p>
          </div>
        ) : (
          <div className="rooms-discovery-grid">
            {filteredRooms.map((room) => (
              <div key={room.roomId} className="room-card fade-in">
                <div className="room-card-header">
                  <span className="live-pill">
                    <span className="live-indicator-dot" /> LIVE
                  </span>
                  <span className="category-badge">{room.category || "Music"}</span>
                  <span className="listeners-badge">🎧 {(room.users?.length || 0) + 1}</span>
                </div>

                <div className="room-card-body">
                  <h3 className="room-card-title">{room.title || `${room.hostName}'s Room`}</h3>
                  <p className="room-card-host subtle-text">Hosted by {room.hostName}</p>
                  {room.currentTrack?.title && (
                    <div className="now-playing-pill">
                      <span>🎵</span>
                      <span className="now-playing-text">
                        {room.currentTrack.title} {room.currentTrack.artist ? `— ${room.currentTrack.artist}` : ""}
                      </span>
                    </div>
                  )}
                </div>

                <div className="room-card-footer">
                  <span className="room-code-tag">{room.roomId}</span>
                  <Link to={`/listen/${room.roomId}`} className="button-primary room-tune-btn">
                    Tune In &rarr;
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Feature Capabilities Banner */}
      <section className="feature-banner">
        <span>⚡ LOSSLESS WEBRTC SRTP AUDIO</span>
        <span>•</span>
        <span>🎵 48KHZ STEREO CAPTURE</span>
        <span>•</span>
        <span>📱 QR SCAN INSTANT JOIN</span>
        <span>•</span>
        <span>🔋 SCREEN-OFF BACKGROUND PLAYBACK</span>
        <span>•</span>
        <span>🎙️ LIVE TRANSCRIPTS & CAPTIONS</span>
      </section>
    </AppShell>
  );
}
