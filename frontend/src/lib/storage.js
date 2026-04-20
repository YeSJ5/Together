const HOST_KEY = "together-host-session";
const LISTENER_KEY = "together-listener-session";

export function saveHostSession(payload) {
  localStorage.setItem(HOST_KEY, JSON.stringify(payload));
}

export function getHostSession() {
  const raw = localStorage.getItem(HOST_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function clearHostSession() {
  localStorage.removeItem(HOST_KEY);
}

export function saveListenerSession(payload) {
  localStorage.setItem(LISTENER_KEY, JSON.stringify(payload));
}

export function getListenerSession() {
  const raw = localStorage.getItem(LISTENER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function clearListenerSession() {
  localStorage.removeItem(LISTENER_KEY);
}
