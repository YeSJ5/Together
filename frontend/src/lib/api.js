import { API_BASE_URL } from "../config";

async function handleResponse(response) {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || "Request failed.");
  }

  return data;
}

export async function createSession(payload) {
  const response = await fetch(`${API_BASE_URL}/create-session`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  return handleResponse(response);
}

export async function fetchSession(roomId) {
  const response = await fetch(`${API_BASE_URL}/session/${roomId}`, {
    cache: "no-store"
  });
  return handleResponse(response);
}

export async function joinSession(roomId, payload) {
  const response = await fetch(`${API_BASE_URL}/session/${roomId}/join`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  return handleResponse(response);
}

export async function leaveSession(roomId, payload) {
  const response = await fetch(`${API_BASE_URL}/session/${roomId}/leave`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

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
  const response = await fetch(`${API_BASE_URL}/session/${roomId}/events`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  return handleResponse(response);
}

export async function fetchSessionEvents(roomId, clientId, since = 0) {
  const response = await fetch(
    `${API_BASE_URL}/session/${roomId}/events?clientId=${encodeURIComponent(
      clientId
    )}&since=${since}&_=${Date.now()}`,
    {
      cache: "no-store"
    }
  );

  return handleResponse(response);
}

export async function endSession(roomId) {
  const response = await fetch(`${API_BASE_URL}/session/${roomId}`, {
    method: "DELETE",
    cache: "no-store"
  });

  return handleResponse(response);
}

export async function fetchRealtimeConfig() {
  const response = await fetch(`${API_BASE_URL}/api/realtime-config`, {
    cache: "no-store"
  });

  return handleResponse(response);
}

export async function createLiveKitToken(roomId, payload) {
  const response = await fetch(`${API_BASE_URL}/session/${roomId}/livekit-token`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  return handleResponse(response);
}
