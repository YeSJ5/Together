import { Link } from "react-router-dom";
import AppShell from "../components/AppShell";

export default function HomePage() {
  return (
    <AppShell>
      <section className="hero-card fade-in">
        <div className="hero-copy">
          <p className="eyebrow">TOGETHER</p>
          <h1>Listen Together. Instantly.</h1>
          <p className="hero-text">
            Share live device audio from one host laptop or browser to nearby
            phones in seconds. Create a session, show the QR, and let listeners
            join synchronized low-latency audio on the same Wi-Fi or hotspot.
            Phones can also host in microphone mode for instant voice sharing.
          </p>
          <div className="hero-actions">
            <Link to="/host" className="button-primary">
              Start as Host
            </Link>
            <Link to="/join" className="button-secondary">
              Join as Listener
            </Link>
          </div>
        </div>
        <div className="hero-panel">
          <div className="metric-card">
            <span>Host modes</span>
            <strong>Laptop Audio, Phone Mic, Audio File</strong>
          </div>
          <div className="metric-card">
            <span>Experience</span>
            <strong>Low-latency live listening</strong>
          </div>
          <div className="metric-card">
            <span>Best environment</span>
            <strong>Same Wi-Fi / Hotspot</strong>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="content-grid slide-up">
        <article className="content-card">
          <h2>How it works</h2>
          <p>
            The host starts a room, captures browser or system audio with
            permission, and broadcasts that audio stream to connected listeners.
          </p>
        </article>
        <article className="content-card">
          <h2>Instant QR Join</h2>
          <p>
            Listeners scan the generated QR code, validate the room, and tap one
            large join button to start playback on mobile or desktop.
          </p>
        </article>
        <article className="content-card">
          <h2>Built for classrooms</h2>
          <p>
            TOGETHER is tuned for nearby group listening in seminar halls,
            labs, hostels, and shared event spaces.
          </p>
        </article>
      </section>
    </AppShell>
  );
}
