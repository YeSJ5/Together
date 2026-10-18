import { io } from "socket.io-client";
import { SOCKET_PATH, SOCKET_URL } from "../config";

export function createSocket() {
  return io(SOCKET_URL, {
    path: SOCKET_PATH,
    transports: ["websocket", "polling"],
    upgrade: true,
    timeout: 10000,
    reconnection: true,
    reconnectionAttempts: 8,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000
  });
}
