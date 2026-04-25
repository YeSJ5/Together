import { useEffect, useMemo, useState } from "react";
import { isMobileBrowser, isStandaloneDisplay } from "../lib/pwa";

const DISMISS_KEY = "together-pwa-prompt-dismissed";

export default function PwaPrompt() {
  const [installEvent, setInstallEvent] = useState(null);
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === "1"
  );
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
    localStorage.setItem(DISMISS_KEY, "1");
  }

  if (!isMobile || isStandalone || dismissed) {
    return null;
  }

  return (
    <section className="install-banner compact-install fade-in">
      <div>
        <strong>Install the TOGETHER app</strong>
        <p className="subtle-text install-copy">
          Install it on your phone for a cleaner mobile experience, faster re-entry, and better background playback support.
        </p>
      </div>
      <div className="install-actions">
        {installEvent ? (
          <button type="button" className="button-primary" onClick={handleInstall}>
            Install App
          </button>
        ) : (
          <p className="subtle-text install-hint">
            Open the browser menu and choose <strong>Install app</strong> if your browser offers it.
          </p>
        )}
        <button
          type="button"
          className="button-secondary"
          onClick={() => {
            setDismissed(true);
            localStorage.setItem(DISMISS_KEY, "1");
          }}
        >
          Hide
        </button>
      </div>
    </section>
  );
}
