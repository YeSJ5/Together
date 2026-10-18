import { API_BASE_URL } from "../config";

const DEFAULT_TIMEOUT_MS = 8000;

export async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  if (options.signal) {
    options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } catch (err) {
    if (err.name === "AbortError" || err.message?.includes("aborted")) {
      const timeoutError = new Error(`Connection to audio service timed out (${timeoutMs}ms). Server may be waking up.`);
      timeoutError.isTimeout = true;
      throw timeoutError;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function handleResponse(response) {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const msg = data.message || `Request failed with status ${response.status}`;
    const error = new Error(msg);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

export async function fetchPublicRooms(signal) {
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/rooms`, {
    cache: "no-store",
    signal
  }, 7000);
  return handleResponse(response);
}

export async function createSession(payload) {
  const response = await fetchWithTimeout(`${API_BASE_URL}/create-session`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  }, 10000);

  return handleResponse(response);
}

export async function fetchSession(roomId, signal) {
  const response = await fetchWithTimeout(`${API_BASE_URL}/session/${roomId}`, {
    cache: "no-store",
    signal
  }, 8000);
  return handleResponse(response);
}

export async function updateSessionSource(roomId, payload) {
  const response = await fetchWithTimeout(`${API_BASE_URL}/session/${roomId}/source`, {
    method: "PATCH",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  }, 6000);

  return handleResponse(response);
}

export async function updateSessionTrack(roomId, payload, hostKey) {
  const headers = {
    "Content-Type": "application/json"
  };
  if (hostKey) {
    headers["x-host-key"] = hostKey;
  }

  const response = await fetchWithTimeout(`${API_BASE_URL}/session/${roomId}/track`, {
    method: "PATCH",
    cache: "no-store",
    headers,
    body: JSON.stringify(payload)
  }, 6000);

  return handleResponse(response);
}

export async function joinSession(roomId, payload) {
  const response = await fetchWithTimeout(`${API_BASE_URL}/session/${roomId}/join`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  }, 8000);

  return handleResponse(response);
}

export async function leaveSession(roomId, payload) {
  const response = await fetchWithTimeout(`${API_BASE_URL}/session/${roomId}/leave`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  }, 5000);

  return handleResponse(response);
}

export function leaveSessionInBackground(roomId, payload) {
  const url = `${API_BASE_URL}/session/${roomId}/leave`;
  const body = JSON.stringify(payload);

  if (navigator.sendBeacon) {
    const blob = new Blob([body], {
      type: "application/json"
    });

    if (navigator.sendBeacon(url, blob)) {
      return;
    }
  }

  fetch(url, {
    method: "POST",
    cache: "no-store",
    keepalive: true,
    headers: {
      "Content-Type": "application/json"
    },
    body
  }).catch(() => {});
}

export async function sendSessionEvent(roomId, payload) {
  const response = await fetchWithTimeout(`${API_BASE_URL}/session/${roomId}/events`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  }, 6000);

  return handleResponse(response);
}

export async function fetchSessionEvents(roomId, clientId, since = 0) {
  const response = await fetchWithTimeout(
    `${API_BASE_URL}/session/${roomId}/events?clientId=${encodeURIComponent(
      clientId
    )}&since=${since}&_=${Date.now()}`,
    {
      cache: "no-store"
    },
    5000
  );

  return handleResponse(response);
}

export async function endSession(roomId, hostKey) {
  const headers = {};
  if (hostKey) {
    headers["x-host-key"] = hostKey;
  }

  const response = await fetchWithTimeout(`${API_BASE_URL}/session/${roomId}`, {
    method: "DELETE",
    cache: "no-store",
    headers
  }, 6000);

  return handleResponse(response);
}

export async function fetchRealtimeConfig() {
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/realtime-config`, {
    cache: "no-store"
  }, 6000);

  return handleResponse(response);
}

export async function createLiveKitToken(roomId, payload) {
  const response = await fetchWithTimeout(`${API_BASE_URL}/session/${roomId}/livekit-token`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  }, 8000);

  return handleResponse(response);
}
