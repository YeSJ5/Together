import { Link, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";

export default function AppShell({ children }) {
  const location = useLocation();
  const isHome = location.pathname === "/";
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [tipMessage, setTipMessage] = useState("");
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

  useEffect(() => {
    // Check if running in standalone mode (already installed)
    const checkInstalled = () => {
      if (typeof window === "undefined") return false;
      return (
        window.matchMedia("(display-mode: standalone)").matches ||
        window.navigator.standalone === true ||
        document.referrer.includes("android-app://")
      );
    };

    if (checkInstalled()) {
      setIsInstalled(true);
    }

    function handleBeforeInstallPrompt(e) {
      e.preventDefault();
      setDeferredPrompt(e);
      window.__togetherInstallPrompt = e;
    }

    function handleAppInstalled() {
      setIsInstalled(true);
      setDeferredPrompt(null);
      window.__togetherInstallPrompt = null;
      setTipMessage("");
    }

    if (window.__togetherInstallPrompt) {
      setDeferredPrompt(window.__togetherInstallPrompt);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  async function handleInstallClick() {
    const promptEvent = deferredPrompt || window.__togetherInstallPrompt;
    if (promptEvent) {
      promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === "accepted") {
        setIsInstalled(true);
      }
      setDeferredPrompt(null);
      window.__togetherInstallPrompt = null;
      return;
    }

    // If native prompt not available (e.g. iOS Safari)
    const isIOS =
      typeof navigator !== "undefined" &&
      /iPad|iPhone|iPod/.test(navigator.userAgent);

    if (isIOS) {
      setTipMessage("Tap Share ⎋ then 'Add to Home Screen' ⊞");
    } else {
      setTipMessage("Tap browser menu ⋮ then 'Install app'");
    }

    setTimeout(() => {
      setTipMessage("");
    }, 4500);
  }

  return (
    <div className="app-frame">
      <main className="page-shell">
        <header className="topbar">
          <Link to="/" className="brand-link">
            <span className="brand-disc" />
            <span>TOGETHER</span>
            <span
              style={{
                fontSize: "0.68rem",
                fontWeight: 800,
                letterSpacing: "0.08em",
                color: "var(--accent-primary)",
                border: "1px solid rgba(16, 185, 129, 0.4)",
                padding: "2px 8px",
                borderRadius: "999px",
                marginLeft: "2px"
              }}
            >
              LIVE
            </span>
          </Link>

          <div className="topbar-actions" style={{ position: "relative" }}>
            {/* Small install icon button at top - hidden once installed */}
            {!isInstalled && (
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={handleInstallClick}
                  title="Install App"
                  aria-label="Install App"
                  style={{
                    width: "34px",
                    height: "34px",
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "rgba(16, 185, 129, 0.12)",
                    border: "1px solid rgba(16, 185, 129, 0.4)",
                    color: "var(--accent-primary)",
                    cursor: "pointer",
                    padding: 0,
                    transition: "all 0.2s ease"
                  }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </button>

                {/* Minimal auto-dismiss tooltip only if manual step is needed (iOS) */}
                {tipMessage && (
                  <div
                    className="fade-in"
                    style={{
                      position: "absolute",
                      top: "42px",
                      right: 0,
                      background: "var(--bg-surface-elevated)",
                      border: "1px solid var(--border-accent)",
                      borderRadius: "10px",
                      padding: "8px 12px",
                      fontSize: "0.78rem",
                      fontWeight: 600,
                      color: "var(--text-main)",
                      whiteSpace: "nowrap",
                      boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
                      zIndex: 100,
                      display: "flex",
                      alignItems: "center",
                      gap: "8px"
                    }}
                  >
                    <span>{tipMessage}</span>
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        setTipMessage("");
                      }}
                      style={{ cursor: "pointer", opacity: 0.6 }}
                    >
                      ✕
                    </span>
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              className="button-secondary theme-toggle"
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
              style={{ fontSize: "0.82rem", padding: "6px 14px" }}
            >
              {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
            </button>

            {!isHome && (
              <Link
                to="/"
                className="button-secondary topbar-home"
                style={{ fontSize: "0.82rem", padding: "6px 14px" }}
              >
                Home
              </Link>
            )}
          </div>
        </header>

        {children}
      </main>
    </div>
  );
}
