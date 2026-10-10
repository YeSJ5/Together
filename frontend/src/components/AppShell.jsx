import { Link, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import InstallModal from "./InstallModal";

export default function AppShell({ children }) {
  const location = useLocation();
  const isHome = location.pathname === "/";
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false);
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem("together-theme");
    if (savedTheme === "dark" || savedTheme === "light") {
      return savedTheme;
    }
    return "dark"; // Default to immersive dark mode for music streaming feel
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("together-theme", theme);
  }, [theme]);

  return (
    <div className="app-frame">
      <main className="page-shell">
        <header className="topbar">
          <Link to="/" className="brand-link">
            <span className="brand-disc" />
            <span>TOGETHER</span>
            <span style={{
              fontSize: "0.68rem",
              fontWeight: 800,
              letterSpacing: "0.08em",
              color: "var(--accent-primary)",
              border: "1px solid rgba(16, 185, 129, 0.4)",
              padding: "2px 8px",
              borderRadius: "999px",
              marginLeft: "2px"
            }}>
              LIVE
            </span>
          </Link>
          <div className="topbar-actions">
            <button
              type="button"
              className="button-primary"
              onClick={() => setIsInstallModalOpen(true)}
              style={{
                fontSize: "0.82rem",
                padding: "6px 14px",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                boxShadow: "0 0 15px rgba(16, 185, 129, 0.3)"
              }}
            >
              <span>📲</span>
              <span>Install App</span>
            </button>
            <button
              type="button"
              className="button-secondary theme-toggle"
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
              style={{ fontSize: "0.82rem", padding: "6px 14px" }}
            >
              {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
            </button>
            {!isHome && (
              <Link to="/" className="button-secondary topbar-home" style={{ fontSize: "0.82rem", padding: "6px 14px" }}>
                Home
              </Link>
            )}
          </div>
        </header>
        {children}
        <InstallModal
          isOpen={isInstallModalOpen}
          onClose={() => setIsInstallModalOpen(false)}
        />
      </main>
    </div>
  );
}

