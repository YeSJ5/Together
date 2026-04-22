function inferLocalBackendBaseUrl() {
  if (typeof window === "undefined") {
    return "https://together-1-2zi8.onrender.com";
  }

  const { protocol, hostname } = window.location;

  if (protocol === "capacitor:" || protocol === "file:") {
    return "https://together-1-2zi8.onrender.com";
  }

  const resolvedProtocol = protocol === "https:" ? "https:" : "http:";
  return `${resolvedProtocol}//${hostname}:5000`;
}

function normalizeBaseUrl(value) {
  if (!value) {
    return inferLocalBackendBaseUrl();
  }

  if (value.startsWith("/")) {
    if (typeof window === "undefined") {
      return value;
    }

    return `${window.location.origin}${value}`;
  }

  return value;
}

export const API_BASE_URL =
  normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);

export const SOCKET_URL =
  normalizeBaseUrl(import.meta.env.VITE_SOCKET_URL);

export const SOCKET_PATH = import.meta.env.VITE_SOCKET_PATH || "/socket.io";

export const PUBLIC_APP_URL =
  import.meta.env.VITE_PUBLIC_APP_URL ||
  (typeof window === "undefined"
    ? "https://together-listen.vercel.app"
    : window.location.origin);
