import { useState, useEffect } from "react";

export default function InstallModal({ isOpen, onClose }) {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [activeTab, setActiveTab] = useState(() => {
    if (typeof navigator === "undefined") return "android";
    const ua = navigator.userAgent || "";
    if (/iPad|iPhone|iPod/.test(ua)) return "ios";
    if (/Android/.test(ua)) return "android";
    return "desktop";
  });

  useEffect(() => {
    // Check if already installed
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
    if (isStandalone) {
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

  if (!isOpen) return null;

  async function handleDirectInstall() {
    const promptEvent = deferredPrompt || window.__togetherInstallPrompt;
    if (promptEvent) {
      promptEvent.prompt();
      const choiceResult = await promptEvent.userChoice;
      if (choiceResult.outcome === "accepted") {
        setIsInstalled(true);
      }
      setDeferredPrompt(null);
      window.__togetherInstallPrompt = null;
    }
  }

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "16px"
      }}
    >
      <div
        className="modal-card fade-in"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-surface-elevated)",
          border: "1px solid var(--border-accent)",
          borderRadius: "var(--radius-card)",
          boxShadow: "0 24px 60px rgba(0, 0, 0, 0.8), 0 0 40px rgba(16, 185, 129, 0.2)",
          maxWidth: "520px",
          width: "100%",
          padding: "28px",
          position: "relative",
          color: "var(--text-main)"
        }}
      >
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          style={{
            position: "absolute",
            top: "18px",
            right: "18px",
            background: "rgba(255, 255, 255, 0.08)",
            border: "none",
            color: "var(--text-secondary)",
            width: "32px",
            height: "32px",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            fontSize: "1rem"
          }}
        >
          ✕
        </button>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "22px" }}>
          <div
            style={{
              width: "60px",
              height: "60px",
              borderRadius: "18px",
              background: "linear-gradient(135deg, #10b981 0%, #06b6d4 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "2rem",
              margin: "0 auto 14px",
              boxShadow: "0 8px 24px rgba(16, 185, 129, 0.4)"
            }}
          >
            📲
          </div>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 800, margin: "0 0 6px", letterSpacing: "-0.02em" }}>
            Install TOGETHER
          </h2>
          <p className="subtle-text" style={{ fontSize: "0.88rem", margin: 0 }}>
            Install as a standalone native app on any device for lock-screen audio, zero browser bars, and instant launch.
          </p>
        </div>

        {/* 1-Click Native Install Button (if browser prompt is ready) */}
        {(deferredPrompt || window.__togetherInstallPrompt) && !isInstalled && (
          <div style={{ marginBottom: "20px" }}>
            <button
              type="button"
              onClick={handleDirectInstall}
              className="button-primary"
              style={{
                width: "100%",
                padding: "16px",
                fontSize: "1rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "10px",
                fontWeight: 700
              }}
            >
              <span>⚡ 1-Click Install to Device</span>
            </button>
          </div>
        )}

        {isInstalled && (
          <div
            style={{
              padding: "12px",
              borderRadius: "var(--radius-control)",
              background: "rgba(16, 185, 129, 0.15)",
              border: "1px solid rgba(16, 185, 129, 0.4)",
              color: "var(--accent-primary)",
              textAlign: "center",
              fontWeight: 700,
              fontSize: "0.9rem",
              marginBottom: "18px"
            }}
          >
            ✓ TOGETHER is already installed on this device!
          </div>
        )}

        {/* Platform Selector Tabs */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: "8px",
            marginBottom: "20px"
          }}
        >
          <button
            type="button"
            className={`button-secondary ${activeTab === "android" ? "active-pill" : ""}`}
            onClick={() => setActiveTab("android")}
            style={{ padding: "10px 8px", fontSize: "0.85rem" }}
          >
            🤖 Android
          </button>
          <button
            type="button"
            className={`button-secondary ${activeTab === "ios" ? "active-pill" : ""}`}
            onClick={() => setActiveTab("ios")}
            style={{ padding: "10px 8px", fontSize: "0.85rem" }}
          >
            🍎 iPhone / iPad
          </button>
          <button
            type="button"
            className={`button-secondary ${activeTab === "desktop" ? "active-pill" : ""}`}
            onClick={() => setActiveTab("desktop")}
            style={{ padding: "10px 8px", fontSize: "0.85rem" }}
          >
            💻 Windows / Mac
          </button>
        </div>

        {/* Tab Guides */}
        <div
          style={{
            background: "rgba(255, 255, 255, 0.03)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-control)",
            padding: "18px"
          }}
        >
          {activeTab === "android" && (
            <div>
              <h3 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "10px", display: "flex", alignItems: "center", gap: "8px" }}>
                <span>🤖 Android (Chrome / Samsung / Edge)</span>
              </h3>
              <ol style={{ paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "10px", fontSize: "0.88rem", lineHeight: 1.5, color: "var(--text-secondary)" }}>
                <li>
                  Tap the <strong style={{ color: "var(--text-main)" }}>⋮ (Three Dots menu)</strong> in Chrome at the top right.
                </li>
                <li>
                  Select <strong style={{ color: "var(--accent-primary)" }}>"Install app"</strong> or <strong style={{ color: "var(--accent-primary)" }}>"Add to Home screen"</strong>.
                </li>
                <li>
                  Tap <strong style={{ color: "var(--text-main)" }}>Install</strong>. TOGETHER appears on your home screen and app drawer as a native app!
                </li>
              </ol>
            </div>
          )}

          {activeTab === "ios" && (
            <div>
              <h3 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "10px", display: "flex", alignItems: "center", gap: "8px" }}>
                <span>🍎 iPhone & iPad (Safari)</span>
              </h3>
              <ol style={{ paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "10px", fontSize: "0.88rem", lineHeight: 1.5, color: "var(--text-secondary)" }}>
                <li>
                  Tap the <strong style={{ color: "var(--text-main)" }}>Share button</strong> <span style={{ fontSize: "1.1rem" }}>⎋</span> (at the bottom toolbar in Safari).
                </li>
                <li>
                  Scroll down the share sheet and tap <strong style={{ color: "var(--accent-primary)" }}>"Add to Home Screen"</strong> <span style={{ fontSize: "1.1rem" }}>⊞</span>.
                </li>
                <li>
                  Tap <strong style={{ color: "var(--accent-primary)" }}>"Add"</strong> in the top right corner. You're done!
                </li>
              </ol>
            </div>
          )}

          {activeTab === "desktop" && (
            <div>
              <h3 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "10px", display: "flex", alignItems: "center", gap: "8px" }}>
                <span>💻 Windows, Mac & Linux</span>
              </h3>
              <ol style={{ paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "10px", fontSize: "0.88rem", lineHeight: 1.5, color: "var(--text-secondary)" }}>
                <li>
                  In Chrome or Edge, look at the right side of the address bar at the top.
                </li>
                <li>
                  Click the <strong style={{ color: "var(--accent-primary)" }}>Install icon</strong> (a small monitor or <strong style={{ color: "var(--accent-primary)" }}>⊕</strong> icon).
                </li>
                <li>
                  Click <strong style={{ color: "var(--text-main)" }}>Install</strong>. TOGETHER opens in its own borderless desktop window with desktop shortcuts!
                </li>
              </ol>
            </div>
          )}
        </div>

        {/* Feature Highlights */}
        <div
          style={{
            marginTop: "18px",
            display: "flex",
            justifyContent: "space-between",
            fontSize: "0.75rem",
            color: "var(--text-muted)",
            fontWeight: 600
          }}
        >
          <span>✓ Works 100% Offline</span>
          <span>✓ Background Audio Enabled</span>
          <span>✓ No App Store Required</span>
        </div>
      </div>
    </div>
  );
}
