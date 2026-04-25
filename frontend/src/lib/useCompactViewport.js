import { useEffect, useState } from "react";

export function useCompactViewport(maxWidth = 820) {
  const getMatches = () => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.innerWidth <= maxWidth;
  };

  const [isCompact, setIsCompact] = useState(getMatches);

  useEffect(() => {
    function handleResize() {
      setIsCompact(getMatches());
    }

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [maxWidth]);

  return isCompact;
}
