const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const { ALLOWED_ORIGINS, PORT } = require("./config");
const {
  createSession,
  deleteSession,
  getRawSession,
  getSession,
  updateSession
} = require("./sessionStore");

const app = express();
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

app.get("/", (_request, response) => {
  response.json({
    product: "TOGETHER",
    status: "running"
  });
});

app.get("/api/health", (_request, response) => {
  response.json({
    product: "TOGETHER",
    status: "ok"
  });
});

app.post("/create-session", (request, response) => {
  const { hostId, audioSourceMode } = request.body || {};

  if (!hostId) {
    return response.status(400).json({
      message: "hostId is required to create a session."
    });
  }

  const session = createSession({ hostId, audioSourceMode });
  return response.status(201).json(session);
});

app.get("/session/:id", (request, response) => {
  const session = getSession(request.params.id);

  if (!session) {
    return response.status(404).json({
      message: "Session not found or expired."
    });
  }

  return response.json(session);
});

app.post("/session/:id/join", (request, response) => {
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
  const session = deleteSession(request.params.id);

  if (!session) {
    return response.status(404).json({
      message: "Session not found or already ended."
    });
  }

  io.to(session.roomId).emit("session-ended", {
    roomId: session.roomId
  });

  return response.json({
    message: "Session ended successfully.",
    session
  });
});

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

io.on("connection", (socket) => {
  socket.on("host-created-room", ({ roomId, hostId }) => {
    const session = getRawSession(roomId);

    if (!session) {
      socket.emit("room-error", {
        roomId,
        message: "The session does not exist."
      });
      return;
    }

    socket.data.role = "host";
    socket.data.roomId = roomId;
    socket.data.peerId = hostId;
    socket.join(roomId);

    updateSession(roomId, (draft) => {
      draft.hostId = hostId;
      draft.status = "active";
    });

    socket.emit("room-ready", {
      roomId
    });
    emitUserCount(roomId);
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
    socket.to(roomId).emit("signal:offer", {
      roomId,
      targetListenerId,
      offer,
      senderId
    });
  });

  socket.on("signal:answer", ({ roomId, targetHostId, answer, senderId }) => {
    socket.to(roomId).emit("signal:answer", {
      roomId,
      targetHostId,
      answer,
      senderId
    });
  });

  socket.on("signal:ice-candidate", ({ roomId, targetId, candidate, senderId }) => {
    socket.to(roomId).emit("signal:ice-candidate", {
      roomId,
      targetId,
      candidate,
      senderId
    });
  });

  socket.on("host-ended-session", ({ roomId }) => {
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
      const session = deleteSession(roomId);

      if (session) {
        io.to(roomId).emit("session-ended", {
          roomId,
          reason: "Host disconnected."
        });
      }

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

server.listen(PORT, () => {
  console.log(`TOGETHER backend listening on port ${PORT}`);
});
