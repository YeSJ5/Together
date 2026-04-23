import { Link, useLocation } from "react-router-dom";
import PwaPrompt from "./PwaPrompt";

export default function AppShell({ children }) {
  const location = useLocation();
  const isHome = location.pathname === "/";
  const shouldShowPwaPrompt =
    location.pathname === "/" ||
    location.pathname.startsWith("/join") ||
    location.pathname.startsWith("/listen");

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
          {!isHome ? (
            <Link to="/" className="button-secondary topbar-home">
              Home
            </Link>
          ) : null}
        </header>
        {shouldShowPwaPrompt ? <PwaPrompt /> : null}
        {children}
      </main>
    </div>
  );
}
