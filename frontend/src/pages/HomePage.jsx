import { Link } from "react-router-dom";
import AppShell from "../components/AppShell";

export default function HomePage() {
  return (
    <AppShell>
      <section className="hero-card home-hero fade-in">
        <div className="hero-copy hero-copy-wide">
          <p className="eyebrow">TOGETHER</p>
          <h1>A shared audio room that opens in seconds.</h1>
          <p className="hero-text">
            TOGETHER lets one device host a live audio session and everyone else join with a single link or QR scan.
            It works for classrooms, events, study rooms, collaborative viewing, voice sharing, and group listening on
            phones or laptops.
          </p>
          <div className="hero-actions">
            <Link to="/host" className="button-primary">
              Open Host Studio
            </Link>
            <Link to="/join" className="button-secondary">
              Join A Session
            </Link>
          </div>
          <div className="hero-mini-grid">
            <div className="mini-feature">
              <span>Live capture</span>
              <strong>Device audio, microphone, or audio file</strong>
            </div>
            <div className="mini-feature">
              <span>Access</span>
              <strong>QR join, room code, and direct listener links</strong>
            </div>
            <div className="mini-feature">
              <span>Experience</span>
              <strong>Real-time playback, room presence, and chat</strong>
            </div>
          </div>
        </div>
        <div className="hero-panel home-hero-panel">
          <div className="home-spotlight">
            <p className="section-kicker">Why it feels simpler</p>
            <div className="spotlight-list">
              <div className="spotlight-row">
                <strong>Host studio</strong>
                <span>Start, monitor, and share from one place</span>
              </div>
              <div className="spotlight-row">
                <strong>Listener flow</strong>
                <span>Scan, validate, join, and resume cleanly</span>
              </div>
              <div className="spotlight-row">
                <strong>Shared room</strong>
                <span>See who is inside and coordinate with chat</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="content-grid home-grid slide-up">
        <article className="content-card">
          <h2>Host with intent</h2>
          <p>
            Choose the source that matches the moment. Device audio is best for browser or system playback, microphone is
            best for speaking rooms, and audio file mode is a stable mobile fallback.
          </p>
        </article>
        <article className="content-card">
          <h2>Join without friction</h2>
          <p>
            Listeners can scan a QR code, use a camera photo, or type the room code manually. The room page validates the
            session before they commit to joining.
          </p>
        </article>
        <article className="content-card">
          <h2>Built for shared moments</h2>
          <p>
            TOGETHER works well for nearby listening, but it is not limited to that. It is just as useful for remote
            room links, companion listening, walkthroughs, and guided sessions.
          </p>
        </article>
      </section>
    </AppShell>
  );
}
