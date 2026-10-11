import { Link, useLocation } from "react-router-dom";
import { useAudioRoom } from "../context/AudioRoomContext";

export default function FloatingMiniPlayer() {
  const location = useLocation();
  const {
    activeRoomId,
    role,
    roomTitle,
    hostName,
    category,
    isPlaying,
    togglePlayback,
    isMuted,
    toggleMute,
    volume,
    setVolume,
    audioLevel,
    currentTrack,
    listenerCount,
    leaveActiveSession
  } = useAudioRoom();

  if (!activeRoomId) {
    return null;
  }

  // Hide the floating mini-player if the user is already on the dedicated full room page
  const isFullRoomPage =
    location.pathname === "/host" ||
    location.pathname === `/listen/${activeRoomId}` ||
    location.pathname === `/session/${activeRoomId}`;

  if (isFullRoomPage) {
    return null;
  }

  const stageLink = role === "host" ? "/host" : `/listen/${activeRoomId}`;

  return (
    <aside
      className="floating-mini-player fade-in"
      aria-label="Persistent Audio Player"
    >
      <div className="mini-player-left">
        <Link to={stageLink} className="mini-player-disc-link" title="Open listening room stage">
          <div className="mini-disc-avatar">
            <span className="mini-disc-core" />
          </div>
        </Link>
        <div className="mini-player-info">
          <div className="mini-player-badges">
            <span className="live-pill">
              <span className="live-indicator-dot" /> LIVE
            </span>
            <span className="mini-category-tag">{category || "Music"}</span>
            <span className="mini-listeners-count">🎧 {listenerCount}</span>
          </div>
          <Link to={stageLink} className="mini-player-title-link">
            <strong className="mini-player-title">
              {currentTrack?.title ? `${currentTrack.title} — ${currentTrack.artist || hostName}` : (roomTitle || `${hostName}'s Room`)}
            </strong>
          </Link>
        </div>
      </div>

      {/* Mini audio equalizer wave */}
      <div className="mini-player-center" aria-hidden="true">
        <div className="mini-eq-bars">
          {[20, 50, 80, 45, 90, 65, 30, 75, 40].map((h, i) => (
            <span
              key={i}
              className="mini-eq-bar"
              style={{
                height: isPlaying ? `${Math.max(4, (h * Math.max(15, audioLevel)) / 100)}px` : "3px",
                opacity: isPlaying ? 0.9 : 0.3
              }}
            />
          ))}
        </div>
      </div>

      <div className="mini-player-right">
        <button
          type="button"
          onClick={togglePlayback}
          className="mini-player-btn play-btn"
          title={isPlaying ? "Pause audio" : "Play audio"}
          aria-label={isPlaying ? "Pause audio" : "Play audio"}
        >
          {isPlaying ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          )}
        </button>

        <button
          type="button"
          onClick={toggleMute}
          className="mini-player-btn mute-btn"
          title={isMuted ? "Unmute" : "Mute"}
          aria-label={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? "🔇" : "🔊"}
        </button>

        <div className="mini-volume-wrapper">
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={isMuted ? 0 : volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="mini-volume-slider"
            aria-label="Volume slider"
          />
        </div>

        <Link to={stageLink} className="button-primary mini-stage-return-btn">
          Stage &rarr;
        </Link>

        <button
          type="button"
          onClick={leaveActiveSession}
          className="mini-player-btn close-btn"
          title="Disconnect and leave room"
          aria-label="Disconnect and leave room"
        >
          ✕
        </button>
      </div>
    </aside>
  );
}
