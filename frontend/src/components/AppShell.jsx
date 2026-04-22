import PwaPrompt from "./PwaPrompt";
import { Link, useLocation } from "react-router-dom";

export default function AppShell({ children, lockNavigation = false, lockLabel = "Session active" }) {
  const location = useLocation();
  const isHome = location.pathname === "/";
  const showPwaPrompt = isHome;

  return (
    <div className="app-frame">
      <div className="background-orb background-orb-left" />
      <div className="background-orb background-orb-right" />
      <main className="page-shell">
        <header className="topbar">
          <div>
            <Link to="/" className="brand-link">
              TOGETHER
            </Link>
            <p className="topbar-copy">Listen Together. Instantly.</p>
          </div>
          {lockNavigation ? (
            <span className="nav-lock-pill">{lockLabel}</span>
          ) : !isHome ? (
            <Link to="/" className="button-secondary topbar-home">
              Home
            </Link>
          ) : null}
        </header>
        {showPwaPrompt ? <PwaPrompt /> : null}
        {children}
      </main>
    </div>
  );
}
