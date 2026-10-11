const express = require("express");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cors = require("cors");
const { Server } = require("socket.io");
const { ALLOWED_ORIGINS, PORT } = require("./config");
const crypto = require("crypto");
const logger = require("./logger");
const { getIceServerConfig } = require("./iceConfig");
const { createRateLimiter } = require("./rateLimiter");
const { createLiveKitToken, getLiveKitConfig, getLiveKitRoomName } = require("./livekit");
const {
  createSession,
  deleteSession,
  getDatabase,
  getRawSession,
  getSession,
  getSessionAsync,
  listActivePublicSessions,
  listActivePublicSessionsAsync,
  setHostConnected,
  updateSession,
  verifyHostKey,
  hydrateSessionsFromDatabase
} = require("./sessionStore");

const app = express();
app.set("trust proxy", 1);
const server = http.createServer(app);

function isOriginAllowed(origin) {
  if (ALLOWED_ORIGINS === "*") {
    return true;
  }

  if (!origin) {
    return true;
  }

  return ALLOWED_ORIGINS.includes(origin);
}

function getLocalIpv4Address() {
  const interfaces = os.networkInterfaces();

  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal) {
        return address.address;
      }
    }
  }

  return null;
}

app.use(
  cors({
    origin(origin, callback) {
      if (isOriginAllowed(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin not allowed by CORS"));
    }
  })
);
app.use(express.json());
app.use((request, response, next) => {
  const reqId = request.headers["x-request-id"] || crypto.randomUUID().slice(0, 8);
  request.reqId = reqId;
  const start = Date.now();

  response.on("finish", () => {
    if (request.path !== "/api/health") {
      logger.info(`${request.method} ${request.originalUrl} [${response.statusCode}] ${Date.now() - start}ms`, {
        reqId,
        method: request.method,
        path: request.originalUrl,
        statusCode: response.statusCode
      });
    }
  });

  if (
    request.path.startsWith("/api") ||
    request.path.startsWith("/session") ||
    request.path.startsWith("/create-session")
  ) {
    response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("Expires", "0");
    response.setHeader("Surrogate-Control", "no-store");
  }

  next();
});

app.get("/api", (_request, response) => {
  response.json({
    product: "TOGETHER",
    version: "2.8.0",
    status: "running"
  });
});

app.get("/api/health", async (_request, response) => {
  try {
    const db = getDatabase();
    const dbHealth = await db.checkHealth();
    const dbRooms = typeof db.listAllActiveRoomsAsync === "function" ? await db.listAllActiveRoomsAsync() : await db.listPublicActiveRoomsAsync();
    const mem = process.memoryUsage();
    const ice = getIceServerConfig();
    const activePublicRooms = await listActivePublicSessionsAsync();

    const isHealthy = dbHealth.healthy !== false && dbHealth.status === "connected";

    return response.status(isHealthy ? 200 : 503).json({
      product: "TOGETHER",
      version: "2.8.0",
      status: isHealthy ? "ok" : "degraded",
      ready: isHealthy,
      uptimeSeconds: Math.floor(process.uptime()),
      database: {
        status: dbHealth.status,
        driver: dbHealth.driver,
        storageType: dbHealth.storageType || "ephemeral-container",
        persistedActiveRooms: dbRooms.length
      },
      presence: {
        activeRooms: activePublicRooms.length,
        connectedSockets: io.engine ? io.engine.clientsCount : 0
      },
      metrics: {
        activeRooms: activePublicRooms.length,
        connectedSockets: io.engine ? io.engine.clientsCount : 0,
        memoryRssMb: Math.round(mem.rss / 1024 / 1024),
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024)
      },
      turnConfigured: ice.hasTurn,
      turnType: ice.turnType || "none"
    });
  } catch (error) {
    logger.error("Health check error", { error: error.message });
    return response.status(503).json({
      product: "TOGETHER",
      status: "degraded",
      ready: false,
      error: error.message
    });
  }
});

const iceRateLimiter = createRateLimiter({
  windowMs: 60000,
  maxRequests: 60,
  message: "Too many ICE configuration requests. Please wait."
});

app.get("/api/ice-servers", iceRateLimiter, (request, response) => {
  const clientId = request.query.clientId || "client";
  const ice = getIceServerConfig({ clientId });
  response.json(ice);
});

app.get("/api/realtime-config", (_request, response) => {
  response.json({
    product: "TOGETHER",
    transport: {
      defaultMode: "webrtc-direct",
      liveKit: getLiveKitConfig()
    },
    mobile: {
      nativeBackgroundAudioRequired: true,
      iosRequiresNativeApp: true,
      androidNativeRecommended: true
    }
  });
});

app.get("/api/runtime", (request, response) => {
  const forwardedProtocol = request.headers["x-forwarded-proto"];
  const protocol = forwardedProtocol || request.protocol || "http";
  const localIp = getLocalIpv4Address();
  const lanOrigin = localIp ? `${protocol}://${localIp}:${PORT}` : null;

  response.json({
    lanOrigin,
    currentOrigin: `${protocol}://${request.get("host")}`
  });
});

app.get("/api/rooms", async (_request, response) => {
  const rooms = await listActivePublicSessionsAsync();
  response.json({
    rooms
  });
});

const createSessionRateLimiter = createRateLimiter({
  windowMs: 600000,
  maxRequests: 30,
  message: "Too many rooms created from this IP. Please wait before creating another."
});

app.post("/create-session", createSessionRateLimiter, (request, response) => {
  const {
    hostId,
    hostName,
    title,
    category,
    isPublic,
    audioSourceMode,
    preferredTransport
  } = request.body || {};

  if (!hostId) {
    return response.status(400).json({
      message: "hostId is required to create a session."
    });
  }

  const liveKitConfig = getLiveKitConfig();
  const useLiveKit = preferredTransport === "livekit" && liveKitConfig.enabled;
  let session = createSession({
    hostId,
    hostName,
    title,
    category,
    isPublic,
    audioSourceMode,
    mediaBackend: useLiveKit ? "livekit" : "webrtc-direct",
    nativeMobileRecommended: true,
    liveKitRoomName: null
  });

  if (useLiveKit) {
    session = updateSession(session.roomId, (draft) => {
      draft.liveKitRoomName = getLiveKitRoomName(session.roomId);
    });
  }

  return response.status(201).json(session);
});

app.patch("/session/:id/track", (request, response) => {
  const { currentTrack } = request.body || {};
  const hostKey = request.headers["x-host-key"] || request.body?.hostKey;
  const session = getRawSession(request.params.id);

  if (!session) {
    return response.status(404).json({
      message: "Session not found or expired."
    });
  }

  if (!verifyHostKey(request.params.id, hostKey)) {
    return response.status(403).json({
      message: "Forbidden: Only the room host can update track metadata."
    });
  }

  const updated = updateSession(request.params.id, (draft) => {
    draft.currentTrack = currentTrack;
  });

  io.to(request.params.id).emit("playback-state-updated", {
    roomId: request.params.id,
    currentTrack
  });

  return response.json(updated);
});

app.post("/session/:id/livekit-token", async (request, response) => {
  const session = getRawSession(request.params.id);
  const {
    participantId,
    participantName,
    role = "listener",
    canPublish,
    canSubscribe,
    canPublishData
  } = request.body || {};

  if (!session) {
    return response.status(404).json({
      message: "Session not found or expired."
    });
  }

  if (!participantId) {
    return response.status(400).json({
      message: "participantId is required."
    });
  }

  try {
    const tokenPayload = await createLiveKitToken({
      roomId: session.roomId,
      participantId,
      participantName,
      role,
      canPublish:
        typeof canPublish === "boolean"
          ? canPublish
          : role === "host" || role === "speaker",
      canSubscribe:
        typeof canSubscribe === "boolean"
          ? canSubscribe
          : true,
      canPublishData:
        typeof canPublishData === "boolean"
          ? canPublishData
          : true
    });

    return response.json({
      ...tokenPayload,
      mediaBackend: "livekit"
    });
  } catch (error) {
    return response.status(503).json({
      message: error.message || "LiveKit token could not be created."
    });
  }
});

app.get("/session/:id", async (request, response) => {
  const session = await getSessionAsync(request.params.id);

  if (!session) {
    return response.status(404).json({
      message: "Session not found or expired."
    });
  }

  return response.json(session);
});

app.patch("/session/:id/source", (request, response) => {
  const { audioSourceMode } = request.body || {};
  const hostKey = request.headers["x-host-key"] || request.body?.hostKey;
  const session = getRawSession(request.params.id);

  if (!session) {
    return response.status(404).json({
      message: "Session not found or expired."
    });
  }

  if (!verifyHostKey(request.params.id, hostKey)) {
    return response.status(403).json({
      message: "Forbidden: Only the room host can change audio sources."
    });
  }

  if (!audioSourceMode) {
    return response.status(400).json({
      message: "audioSourceMode is required."
    });
  }

  const updated = updateSession(request.params.id, (draft) => {
    draft.audioSourceMode = audioSourceMode;
  });

  return response.json(updated);
});

const joinSessionRateLimiter = createRateLimiter({
  windowMs: 60000,
  maxRequests: 120,
  message: "Too many join attempts. Please slow down."
});

app.post("/session/:id/join", joinSessionRateLimiter, (request, response) => {
  const { listenerId, username } = request.body || {};
  const session = getRawSession(request.params.id);

  if (!session) {
    return response.status(404).json({
      message: "Invalid room or expired session."
    });
  }

  if (!listenerId) {
    return response.status(400).json({
      message: "listenerId is required."
    });
  }

  const updated = updateSession(request.params.id, (draft) => {
    const alreadyPresent = draft.users.some((user) => user.id === listenerId);

    if (!alreadyPresent) {
      draft.users.push({
        id: listenerId,
        username: username || "Listener",
        joinedAt: Date.now()
      });
    }

    draft.events.push({
      id: draft.nextEventId++,
      type: "listener-joined-room",
      senderId: listenerId,
      targetId: draft.hostId,
      payload: {
        listenerId,
        username: username || "Listener"
      },
      createdAt: Date.now()
    });
  });

  return response.json(updated);
});

app.post("/session/:id/leave", (request, response) => {
  const { listenerId } = request.body || {};
  const session = getRawSession(request.params.id);

  if (!session) {
    return response.status(404).json({
      message: "Session not found or expired."
    });
  }

  if (!listenerId) {
    return response.status(400).json({
      message: "listenerId is required."
    });
  }

  updateSession(request.params.id, (draft) => {
    draft.users = draft.users.filter((user) => user.id !== listenerId);
    draft.events.push({
      id: draft.nextEventId++,
      type: "listener-disconnected",
      senderId: listenerId,
      targetId: draft.hostId,
      payload: {
        listenerId
      },
      createdAt: Date.now()
    });
  });

  return response.json({
    message: "Listener removed."
  });
});

app.post("/session/:id/events", (request, response) => {
  const { senderId, targetId, type, payload } = request.body || {};
  const session = getRawSession(request.params.id);

  if (!session) {
    return response.status(404).json({
      message: "Session not found or expired."
    });
  }

  if (!senderId || !type) {
    return response.status(400).json({
      message: "senderId and type are required."
    });
  }

  const updated = updateSession(request.params.id, (draft) => {
    draft.events.push({
      id: draft.nextEventId++,
      type,
      senderId,
      targetId: targetId || null,
      payload: payload || {},
      createdAt: Date.now()
    });
  });

  return response.status(201).json({
    latestEventId: updated ? getRawSession(request.params.id).nextEventId - 1 : null
  });
});

app.get("/session/:id/events", (request, response) => {
  const { clientId, since } = request.query;
  const session = getRawSession(request.params.id);

  if (!session) {
    return response.status(404).json({
      message: "Session not found or expired."
    });
  }

  const sinceId = Number(since) || 0;
  const events = session.events.filter((event) => {
    if (event.id <= sinceId) {
      return false;
    }

    if (!event.targetId) {
      return true;
    }

    return event.targetId === clientId;
  });

  return response.json({
    events
  });
});

app.delete("/session/:id", (request, response) => {
  const hostKey = request.headers["x-host-key"] || request.body?.hostKey || request.query?.hostKey;
  const rawSession = getRawSession(request.params.id);

  if (!rawSession) {
    return response.status(404).json({
      message: "Session not found or already ended."
    });
  }

  if (!verifyHostKey(request.params.id, hostKey)) {
    return response.status(403).json({
      message: "Forbidden: Only the room host can end this session."
    });
  }

  const session = deleteSession(request.params.id);

  io.to(session.roomId).emit("session-ended", {
    roomId: session.roomId
  });

  return response.json({
    message: "Session ended successfully.",
    session
  });
});

const clientDistPath = path.resolve(__dirname, "../../frontend/dist");
const clientIndexPath = path.join(clientDistPath, "index.html");
const hasBundledFrontend = fs.existsSync(clientIndexPath);

if (hasBundledFrontend) {
  app.use(express.static(clientDistPath));

  app.get("*", (request, response, next) => {
    if (
      request.path.startsWith("/api") ||
      request.path.startsWith("/session") ||
      request.path.startsWith("/create-session")
    ) {
      next();
      return;
    }

    response.sendFile(clientIndexPath);
  });
} else {
  app.get("/", (_request, response) => {
    response.json({
      product: "TOGETHER",
      status: "backend-only",
      message: "Frontend is deployed separately. Use the Vercel app URL for the web interface."
    });
  });
}

const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      if (isOriginAllowed(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin not allowed by Socket.IO CORS"));
    },
    methods: ["GET", "POST", "DELETE"]
  }
});

function emitUserCount(roomId) {
  const session = getRawSession(roomId);

  if (!session) {
    return;
  }

  io.to(roomId).emit("user-count-updated", {
    roomId,
    count: session.users.length,
    users: session.users
  });
}

const hostDisconnectTimers = new Map();

io.on("connection", (socket) => {
  socket.on("host-created-room", ({ roomId, hostId, hostKey }) => {
    if (hostDisconnectTimers.has(roomId)) {
      clearTimeout(hostDisconnectTimers.get(roomId));
      hostDisconnectTimers.delete(roomId);
    }

    const session = getRawSession(roomId);

    if (!session) {
      socket.emit("room-error", {
        roomId,
        message: "The session does not exist."
      });
      return;
    }

    if (session.hostKey && !verifyHostKey(roomId, hostKey)) {
      socket.emit("room-error", {
        roomId,
        message: "Forbidden: Invalid host key."
      });
      return;
    }

    socket.data.role = "host";
    socket.data.roomId = roomId;
    socket.data.peerId = hostId;
    socket.data.isAuthorizedHost = true;
    socket.join(roomId);
    setHostConnected(roomId, true);

    updateSession(roomId, (draft) => {
      draft.hostId = hostId;
      draft.status = "active";
    });

    socket.emit("room-ready", {
      roomId
    });
    emitUserCount(roomId);

    // If any listeners were already waiting in the room, notify reconnected host so WebRTC can negotiate
    if (Array.isArray(session.users) && session.users.length > 0) {
      for (const listener of session.users) {
        socket.emit("listener-joined-room", {
          roomId,
          listenerId: listener.id,
          username: listener.username || "Listener"
        });
      }
    }
  });

  socket.on("listener-joined-room", ({ roomId, listenerId, username }) => {
    const session = getRawSession(roomId);

    if (!session) {
      socket.emit("room-error", {
        roomId,
        message: "Invalid room or expired session."
      });
      return;
    }

    socket.data.role = "listener";
    socket.data.roomId = roomId;
    socket.data.peerId = listenerId;
    socket.join(roomId);

    updateSession(roomId, (draft) => {
      const alreadyPresent = draft.users.some((user) => user.id === listenerId);

      if (!alreadyPresent) {
        draft.users.push({
          id: listenerId,
          username: username || "Listener",
          joinedAt: Date.now()
        });
      }
    });

    io.to(roomId).emit("listener-joined-room", {
      roomId,
      listenerId,
      username: username || "Listener"
    });
    emitUserCount(roomId);
  });

  socket.on("signal:offer", ({ roomId, targetListenerId, offer, senderId }) => {
    if (!socket.data.roomId || socket.data.roomId !== roomId) {
      return; // Reject cross-room signaling
    }
    socket.to(roomId).emit("signal:offer", {
      roomId,
      targetListenerId,
      offer,
      senderId
    });
  });

  socket.on("signal:answer", ({ roomId, targetHostId, answer, senderId }) => {
    if (!socket.data.roomId || socket.data.roomId !== roomId) {
      return; // Reject cross-room signaling
    }
    socket.to(roomId).emit("signal:answer", {
      roomId,
      targetHostId,
      answer,
      senderId
    });
  });

  socket.on("signal:ice-candidate", ({ roomId, targetId, candidate, senderId }) => {
    if (!socket.data.roomId || socket.data.roomId !== roomId) {
      return; // Reject cross-room signaling
    }
    socket.to(roomId).emit("signal:ice-candidate", {
      roomId,
      targetId,
      candidate,
      senderId
    });
  });

  socket.on("chat-message", ({ roomId, senderId, senderName, message }) => {
    if (!socket.data.roomId || socket.data.roomId !== roomId || !message) {
      return; // Reject cross-room or empty chat
    }

    const payload = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      roomId,
      senderId,
      senderName: senderName || "Participant",
      message: String(message).trim().slice(0, 500),
      createdAt: Date.now()
    };

    io.to(roomId).emit("chat-message", payload);
  });

  socket.on("reaction", ({ roomId, emoji, senderName }) => {
    if (!socket.data.roomId || socket.data.roomId !== roomId || !emoji) {
      return; // Reject cross-room or empty reaction
    }

    io.to(roomId).emit("reaction", {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      roomId,
      emoji: String(emoji).slice(0, 8),
      senderName: senderName || "Listener",
      createdAt: Date.now()
    });
  });

  socket.on("transcript-chunk", ({ roomId, text, isFinal, senderName }) => {
    if (!socket.data.roomId || socket.data.roomId !== roomId || !text) {
      return;
    }
    if (socket.data.role !== "host" || !socket.data.isAuthorizedHost) {
      return; // Only verified hosts can publish transcript chunks
    }

    io.to(roomId).emit("transcript-chunk", {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      roomId,
      text: String(text).slice(0, 500),
      isFinal: Boolean(isFinal),
      senderName: senderName || "Host",
      timestamp: Date.now()
    });
  });

  socket.on("playback-sync", ({ roomId, currentTrack }) => {
    if (!socket.data.roomId || socket.data.roomId !== roomId) {
      return;
    }
    if (socket.data.role !== "host" || !socket.data.isAuthorizedHost) {
      return; // Only verified hosts can sync playback state
    }

    updateSession(roomId, (draft) => {
      draft.currentTrack = currentTrack;
    });

    socket.to(roomId).emit("playback-state-updated", {
      roomId,
      currentTrack
    });
  });

  socket.on("listener-left-room", ({ roomId, listenerId }) => {
    if (!socket.data.roomId || socket.data.roomId !== roomId || !listenerId) {
      return;
    }
    if (socket.data.peerId !== listenerId && !socket.data.isAuthorizedHost) {
      return; // Cannot disconnect other peers unless authorized host
    }

    const updated = updateSession(roomId, (draft) => {
      draft.users = draft.users.filter((user) => user.id !== listenerId);
    });

    if (updated) {
      io.to(roomId).emit("listener-disconnected", {
        roomId,
        listenerId
      });
      emitUserCount(roomId);
    }
  });

  socket.on("host-ended-session", ({ roomId, hostKey }) => {
    if (!socket.data.roomId || socket.data.roomId !== roomId) {
      return;
    }
    if (!socket.data.isAuthorizedHost && !verifyHostKey(roomId, hostKey)) {
      socket.emit("room-error", {
        roomId,
        message: "Forbidden: Unauthorized host action."
      });
      return;
    }

    if (hostDisconnectTimers.has(roomId)) {
      clearTimeout(hostDisconnectTimers.get(roomId));
      hostDisconnectTimers.delete(roomId);
    }

    const session = deleteSession(roomId);

    if (!session) {
      return;
    }

    io.to(roomId).emit("session-ended", {
      roomId
    });
  });

  socket.on("disconnect", () => {
    const { roomId, role, peerId } = socket.data;

    if (!roomId || !peerId) {
      return;
    }

    if (role === "host") {
      setHostConnected(roomId, false);
      const timer = setTimeout(() => {
        hostDisconnectTimers.delete(roomId);
        const session = deleteSession(roomId);

        if (session) {
          io.to(roomId).emit("session-ended", {
            roomId,
            reason: "Host ended the session."
          });
        }
      }, 20000);

      hostDisconnectTimers.set(roomId, timer);
      return;
    }

    if (role === "listener") {
      const updated = updateSession(roomId, (draft) => {
        draft.users = draft.users.filter((user) => user.id !== peerId);
      });

      if (updated) {
        io.to(roomId).emit("listener-disconnected", {
          roomId,
          listenerId: peerId
        });
        emitUserCount(roomId);
      }
    }
  });
});

// Periodic cleanup of abandoned/stale rooms (runs every 30 minutes)
setInterval(() => {
  try {
    const db = getDatabase();
    db.cleanupStaleRooms();
  } catch (err) {
    logger.warn("Periodic room cleanup error", { error: err.message });
  }
}, 30 * 60 * 1000).unref();

server.listen(PORT, "0.0.0.0", async () => {
  const localIp = getLocalIpv4Address();
  logger.info(`TOGETHER backend listening on port ${PORT}`, {
    port: PORT,
    localUrl: `http://localhost:${PORT}`,
    lanUrl: localIp ? `http://${localIp}:${PORT}` : null
  });

  try {
    const db = getDatabase();
    await db.waitForReady();
    if (typeof db.cleanupStaleRooms === "function") {
      db.cleanupStaleRooms();
    }
    await hydrateSessionsFromDatabase();
    const health = await db.checkHealth();
    logger.info(`[DB Startup] Selected driver: ${health.driver} | Storage: ${health.storageType} | Status: ${health.status}`, {
      driver: health.driver,
      storageType: health.storageType,
      healthy: health.healthy
    });
    if (!health.healthy) {
      logger.warn(`[DB Startup] Database initialization degraded: ${health.error || "unhealthy"}`);
      if (process.env.REQUIRE_POSTGRES === "true" || process.env.REQUIRE_POSTGRES === "1") {
        logger.error("[DB Startup] FATAL: REQUIRE_POSTGRES is enabled but PostgreSQL connection/schema check failed.");
      }
    }
  } catch (err) {
    logger.error("[DB Startup] Database initialization error", { error: err.message });
  }
});

