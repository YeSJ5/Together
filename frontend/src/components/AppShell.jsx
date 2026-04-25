import { Link, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import PwaPrompt from "./PwaPrompt";

export default function AppShell({ children }) {
  const location = useLocation();
  const isHome = location.pathname === "/";
  const shouldShowPwaPrompt =
    location.pathname === "/" ||
    location.pathname.startsWith("/join") ||
    location.pathname.startsWith("/listen");
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem("together-theme");
    if (savedTheme === "dark" || savedTheme === "light") {
      return savedTheme;
    }

    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches
      ? "dark"
      : "light";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("together-theme", theme);
  }, [theme]);

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
          <div className="topbar-actions">
            <button
              type="button"
              className="button-secondary theme-toggle"
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
            >
              {theme === "dark" ? "Light Mode" : "Dark Mode"}
            </button>
            {!isHome ? (
              <Link to="/" className="button-secondary topbar-home">
                Home
              </Link>
            ) : null}
          </div>
        </header>
        {shouldShowPwaPrompt ? <PwaPrompt /> : null}
        {children}
      </main>
    </div>
  );
}
