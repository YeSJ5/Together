import { useEffect, useMemo, useState } from "react";
import { isMobileBrowser, isStandaloneDisplay } from "../lib/pwa";

const DISMISS_KEY = "together-pwa-prompt-dismissed-session";

function getInstallHelpText() {
  if (typeof navigator === "undefined") {
    return "Open your browser menu and choose Install app.";
  }

  const userAgent = navigator.userAgent || "";

  if (/iPhone|iPad|iPod/i.test(userAgent)) {
    return "On iPhone or iPad, tap Share and then Add to Home Screen.";
  }

  if (/SamsungBrowser/i.test(userAgent)) {
    return "On Samsung Internet, open the menu and choose Add page to, then Home screen or Apps screen.";
  }

  return "Open your browser menu and choose Install app.";
}

export default function PwaPrompt() {
  const [installEvent, setInstallEvent] = useState(null);
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem(DISMISS_KEY) === "1"
  );
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const isMobile = useMemo(() => isMobileBrowser(), []);
  const isStandalone = useMemo(() => isStandaloneDisplay(), []);
  const installHelpText = useMemo(() => getInstallHelpText(), []);

  useEffect(() => {
    const storedInstallEvent = window.__togetherDeferredInstallPrompt;

    if (storedInstallEvent) {
      setInstallEvent(storedInstallEvent);
    }

    function handleBeforeInstallPrompt(event) {
      event.preventDefault();
      window.__togetherDeferredInstallPrompt = event;
      setInstallEvent(event);
      setDismissed(false);
      sessionStorage.removeItem(DISMISS_KEY);
    }

    function handleInstalled() {
      window.__togetherDeferredInstallPrompt = null;
      setInstallEvent(null);
      setDismissed(true);
      sessionStorage.setItem(DISMISS_KEY, "1");
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  async function handleInstall() {
    if (!installEvent) {
      setShowInstallHelp(true);
      return;
    }

    installEvent.prompt();
    const choice = await installEvent.userChoice.catch(() => null);
    window.__togetherDeferredInstallPrompt = null;
    setInstallEvent(null);

    if (choice?.outcome === "accepted") {
      setDismissed(true);
      sessionStorage.setItem(DISMISS_KEY, "1");
      return;
    }

    setShowInstallHelp(true);
  }

  if (!isMobile || isStandalone || dismissed) {
    return null;
  }

  return (
    <section className="install-banner compact-install fade-in">
      <div>
        <strong>Install the TOGETHER app</strong>
        <p className="subtle-text install-copy">
          Install it on your phone for a cleaner mobile experience, faster re-entry, and better playback support.
        </p>
      </div>
      <div className="install-actions">
        <button type="button" className="button-primary" onClick={handleInstall}>
          Install App
        </button>
        {showInstallHelp ? (
          <p className="subtle-text install-hint">
            {installHelpText}
          </p>
        ) : null}
        <button
          type="button"
          className="button-secondary"
          onClick={() => {
            setDismissed(true);
            sessionStorage.setItem(DISMISS_KEY, "1");
          }}
        >
          Hide
        </button>
      </div>
    </section>
  );
}
