import { Link, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { API_BASE_URL } from "../config";
import { fetchWithTimeout } from "../lib/api";
import FloatingMiniPlayer from "./FloatingMiniPlayer";
import AudioDiagnosticsModal from "./AudioDiagnosticsModal";
import AboutModal from "./AboutModal";

export default function AppShell({ children }) {
  const location = useLocation();
  const isHome = location.pathname === "/";
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [tipMessage, setTipMessage] = useState("");
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem("together-theme");
    if (savedTheme === "dark" || savedTheme === "light") {
      return savedTheme;
    }
    return "dark"; // Default to immersive dark mode for music streaming feel
  });

  useEffect(() => {
    // Proactively warm up backend to eliminate broadcast setup delay (bounded to 5s)
    fetchWithTimeout(`${API_BASE_URL}/api/health`, { cache: "no-store" }, 5000).catch(() => {});
  }, []);

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
        window.navigator.standalone === true
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
            <span className="brand-wordmark">TOGETHER</span>
            <span className="live-header-pill">LIVE</span>
          </Link>

          <div className="topbar-actions">
            <button
              type="button"
              className="button-secondary topbar-action-btn"
              onClick={() => setIsDiagnosticsOpen(true)}
              title="Audio settings and microphone test"
            >
              ⚙️ <span className="topbar-btn-text">Audio</span>
            </button>

            <button
              type="button"
              className="button-secondary topbar-action-btn"
              onClick={() => setIsAboutOpen(true)}
              title="About TOGETHER & Vision"
            >
              ℹ️ <span className="topbar-btn-text">About</span>
            </button>

            {/* Small install icon button at top - hidden once installed */}
            {!isInstalled && (
              <div style={{ position: "relative", flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={handleInstallClick}
                  title="Install App"
                  aria-label="Install App"
                  className="install-pill-btn"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  <span className="topbar-btn-text">Install</span>
                </button>

                {tipMessage && (
                  <div className="tooltip-bubble fade-in">
                    <span>{tipMessage}</span>
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        setTipMessage("");
                      }}
                      style={{ cursor: "pointer", opacity: 0.7 }}
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
              title="Toggle color theme"
            >
              {theme === "dark" ? "☀️" : "🌙"}
            </button>

            {!isHome && (
              <Link to="/" className="button-secondary topbar-home">
                Home
              </Link>
            )}
          </div>
        </header>

        {children}

        {/* Global Footer with Creator's Signature S_/_/ */}
        <footer className="app-footer">
          <div className="footer-content">
            <div className="footer-left">
              <span className="brand-disc footer-disc" />
              <span className="footer-brand">TOGETHER</span>
              <span className="footer-tagline subtle-text">
                • Browser-first real-time audio platform
              </span>
            </div>
            <div className="footer-right">
              <span className="footer-creator-text subtle-text">
                Designed & Engineered with precision by{" "}
                <button
                  type="button"
                  className="creator-signature-btn"
                  onClick={() => setIsAboutOpen(true)}
                  title="Creator's Signature & Story"
                >
                  S_/_/
                </button>
              </span>
            </div>
          </div>
        </footer>
      </main>

      {/* Floating Persistent Mini Player (Background Audio across internal navigation) */}
      <FloatingMiniPlayer />

      {/* Settings & Hardware Diagnostics Dialog */}
      <AudioDiagnosticsModal
        isOpen={isDiagnosticsOpen}
        onClose={() => setIsDiagnosticsOpen(false)}
      />

      {/* About & Product Story Dialog */}
      <AboutModal
        isOpen={isAboutOpen}
        onClose={() => setIsAboutOpen(false)}
      />
    </div>
  );
}
