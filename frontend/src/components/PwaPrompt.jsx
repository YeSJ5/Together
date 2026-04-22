import { useEffect, useMemo, useState } from "react";

function isMobileBrowser() {
  if (typeof navigator === "undefined") {
    return false;
  }

  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

function isStandaloneDisplay() {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator.standalone === true
  );
}

export default function PwaPrompt() {
  const [installEvent, setInstallEvent] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const isMobile = useMemo(() => isMobileBrowser(), []);
  const isStandalone = useMemo(() => isStandaloneDisplay(), []);

  useEffect(() => {
    function handleBeforeInstallPrompt(event) {
      event.preventDefault();
      setInstallEvent(event);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  async function handleInstall() {
    if (!installEvent) {
      return;
    }

    installEvent.prompt();
    await installEvent.userChoice.catch(() => null);
    setInstallEvent(null);
    setDismissed(true);
  }

  if (!isMobile || isStandalone || dismissed) {
    return null;
  }

  return (
    <section className="install-banner fade-in">
      <div>
        <p className="eyebrow">Mobile Upgrade</p>
        <strong>Install TOGETHER for better background playback</strong>
        <p className="subtle-text install-copy">
          Installed mode is more stable when the screen dims or you briefly switch apps.
          Phones can also host in microphone mode directly from the app.
        </p>
      </div>
      <div className="install-actions">
        {installEvent ? (
          <button type="button" className="button-primary" onClick={handleInstall}>
            Install App
          </button>
        ) : (
          <p className="subtle-text install-hint">
            Use your browser menu and choose <strong>Add to Home screen</strong>.
          </p>
        )}
        <button
          type="button"
          className="button-secondary"
          onClick={() => setDismissed(true)}
        >
          Maybe later
        </button>
      </div>
    </section>
  );
}
