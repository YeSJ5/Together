import { useEffect } from "react";

export function useNavigationLock(locked, message) {
  useEffect(() => {
    if (!locked || typeof window === "undefined") {
      return undefined;
    }

    const currentUrl = window.location.href;

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = message;
      return message;
    };

    const handlePopState = () => {
      window.history.pushState({ togetherLocked: true }, "", currentUrl);
    };

    window.history.pushState({ togetherLocked: true }, "", currentUrl);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [locked, message]);
}
