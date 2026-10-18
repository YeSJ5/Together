const assert = require("node:assert");
const test = require("node:test");
const http = require("node:http");
const express = require("express");
const { Server } = require("socket.io");
const { io: ioClient } = require("socket.io-client");

const {
  createSession,
  getRawSession,
  getSession,
  updateSession,
  setHostConnected,
  clearAllSessionsForTesting
} = require("../src/sessionStore");

function waitForConnect(socket) {
  if (socket.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Socket connect timeout")), 4000);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function createTestServer() {
  const app = express();
  app.use(express.json());

  app.get("/session/:id", (req, res) => {
    const session = getSession(req.params.id);
    if (!session) return res.status(404).json({ message: "Session not found." });
    res.json(session);
  });

  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: "*" } });

  io.on("connection", (socket) => {
    socket.on("host-created-room", ({ roomId, hostId }) => {
      const session = getRawSession(roomId);
      if (!session) {
        socket.emit("room-error", { roomId, message: "The session does not exist." });
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

      socket.emit("room-ready", { roomId });
      socket.to(roomId).emit("host-connected", { roomId, hostName: session.hostName });
    });

    socket.on("listener-joined-room", ({ roomId, listenerId, username }) => {
      const session = getRawSession(roomId);
      if (!session) {
        socket.emit("room-error", { roomId, message: "Invalid room or expired session." });
        return;
      }
      socket.data.role = "listener";
      socket.data.roomId = roomId;
      socket.data.peerId = listenerId;
      socket.join(roomId);

      updateSession(roomId, (draft) => {
        const alreadyPresent = draft.users.some((u) => u.id === listenerId);
        if (!alreadyPresent) {
          draft.users.push({ id: listenerId, username: username || "Listener", joinedAt: Date.now() });
        }
      });

      socket.emit("room-joined", {
        roomId,
        hostConnected: Boolean(session.hostConnected),
        hostName: session.hostName,
        title: session.title,
        category: session.category,
        currentTrack: session.currentTrack
      });

      io.to(roomId).emit("listener-joined-room", {
        roomId,
        listenerId,
        username: username || "Listener"
      });
    });

    socket.on("signal:offer", ({ roomId, targetListenerId, offer, senderId }) => {
      if (!socket.data.roomId || socket.data.roomId !== roomId) return;
      socket.to(roomId).emit("signal:offer", { roomId, targetListenerId, offer, senderId });
    });

    socket.on("signal:answer", ({ roomId, targetHostId, answer, senderId }) => {
      if (!socket.data.roomId || socket.data.roomId !== roomId) return;
      socket.to(roomId).emit("signal:answer", { roomId, targetHostId, answer, senderId });
    });

    socket.on("signal:ice-candidate", ({ roomId, targetId, candidate, senderId }) => {
      if (!socket.data.roomId || socket.data.roomId !== roomId) return;
      socket.to(roomId).emit("signal:ice-candidate", { roomId, targetId, candidate, senderId });
    });

    socket.on("listener-left-room", ({ roomId, listenerId }) => {
      if (!socket.data.roomId || socket.data.roomId !== roomId) return;
      updateSession(roomId, (draft) => {
        draft.users = draft.users.filter((u) => u.id !== listenerId);
      });
      socket.to(roomId).emit("listener-disconnected", { roomId, listenerId });
    });

    socket.on("disconnect", () => {
      const { role, roomId, peerId } = socket.data;
      if (role === "host" && roomId) {
        setHostConnected(roomId, false);
        socket.to(roomId).emit("host-disconnected", {
          roomId,
          reason: "Host temporarily disconnected."
        });
      }
      if (role === "listener" && roomId && peerId) {
        updateSession(roomId, (draft) => {
          draft.users = draft.users.filter((u) => u.id !== peerId);
        });
        socket.to(roomId).emit("listener-disconnected", { roomId, listenerId: peerId });
      }
    });
  });

  return { server, io };
}

test("Listener Lifecycle: room-joined confirmation with host status awareness", async () => {
  const { server } = createTestServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const serverUrl = `http://localhost:${port}`;

  clearAllSessionsForTesting();
  const session = createSession({
    hostId: "host-active-1",
    hostName: "Live DJ",
    title: "Saturday Chillout",
    category: "Music"
  });

  // Explicitly set host disconnected to test "waiting for host" state
  setHostConnected(session.roomId, false);

  const listenerSocket = ioClient(serverUrl, { transports: ["websocket"] });
  let hostSocket = null;

  try {
    await waitForConnect(listenerSocket);

    const roomJoinedPromise = new Promise((resolve) => {
      listenerSocket.once("room-joined", resolve);
    });

    listenerSocket.emit("listener-joined-room", {
      roomId: session.roomId,
      listenerId: "listener-1",
      username: "Alex"
    });

    const joinedData = await roomJoinedPromise;
    assert.strictEqual(joinedData.roomId, session.roomId);
    assert.strictEqual(joinedData.hostConnected, false);
    assert.strictEqual(joinedData.hostName, "Live DJ");

    // Now host connects
    hostSocket = ioClient(serverUrl, { transports: ["websocket"] });
    await waitForConnect(hostSocket);

    const hostConnectedPromise = new Promise((resolve) => {
      listenerSocket.once("host-connected", resolve);
    });

    hostSocket.emit("host-created-room", {
      roomId: session.roomId,
      hostId: "host-active-1",
      hostKey: session.hostKey
    });

    const hostEvent = await hostConnectedPromise;
    assert.strictEqual(hostEvent.roomId, session.roomId);
    assert.strictEqual(hostEvent.hostName, "Live DJ");

    // Host disconnects: listener receives host-disconnected
    const hostDisconnectedPromise = new Promise((resolve) => {
      listenerSocket.once("host-disconnected", resolve);
    });

    hostSocket.disconnect();
    const hostDisconnectEvent = await hostDisconnectedPromise;
    assert.strictEqual(hostDisconnectEvent.roomId, session.roomId);
  } finally {
    listenerSocket.disconnect();
    if (hostSocket) hostSocket.disconnect();
    await new Promise((res) => server.close(res));
  }
});

test("Listener Lifecycle: invalid room returns room-error promptly", async () => {
  const { server } = createTestServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const serverUrl = `http://localhost:${port}`;

  const listenerSocket = ioClient(serverUrl, { transports: ["websocket"] });
  try {
    await waitForConnect(listenerSocket);

    const errorPromise = new Promise((resolve) => {
      listenerSocket.once("room-error", resolve);
    });

    listenerSocket.emit("listener-joined-room", {
      roomId: "ROOM-NONEXISTENT",
      listenerId: "listener-bad",
      username: "Sam"
    });

    const errorData = await errorPromise;
    assert.ok(errorData.message.includes("Invalid room or expired session"));
  } finally {
    listenerSocket.disconnect();
    await new Promise((res) => server.close(res));
  }
});

test("Listener Lifecycle: signaling exchange and ICE candidate routing", async () => {
  const { server } = createTestServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const serverUrl = `http://localhost:${port}`;

  clearAllSessionsForTesting();
  const session = createSession({
    hostId: "host-sig-1",
    hostName: "Signaling Host",
    title: "Signaling Test",
    category: "Music"
  });

  const hostSocket = ioClient(serverUrl, { transports: ["websocket"] });
  const listenerSocket = ioClient(serverUrl, { transports: ["websocket"] });

  try {
    await waitForConnect(hostSocket);
    hostSocket.emit("host-created-room", {
      roomId: session.roomId,
      hostId: "host-sig-1",
      hostKey: session.hostKey
    });

    await waitForConnect(listenerSocket);

    // Host awaits listener join
    const listenerJoinedOnHost = new Promise((resolve) => {
      hostSocket.once("listener-joined-room", resolve);
    });

    listenerSocket.emit("listener-joined-room", {
      roomId: session.roomId,
      listenerId: "listener-sig-1",
      username: "TestListener"
    });

    await listenerJoinedOnHost;

    // Host sends offer
    const offerPromise = new Promise((resolve) => {
      listenerSocket.once("signal:offer", resolve);
    });

    hostSocket.emit("signal:offer", {
      roomId: session.roomId,
      targetListenerId: "listener-sig-1",
      offer: { type: "offer", sdp: "dummy-offer-sdp" },
      senderId: "host-sig-1"
    });

    const receivedOffer = await offerPromise;
    assert.strictEqual(receivedOffer.offer.sdp, "dummy-offer-sdp");

    // Listener sends answer
    const answerPromise = new Promise((resolve) => {
      hostSocket.once("signal:answer", resolve);
    });

    listenerSocket.emit("signal:answer", {
      roomId: session.roomId,
      targetHostId: "host-sig-1",
      answer: { type: "answer", sdp: "dummy-answer-sdp" },
      senderId: "listener-sig-1"
    });

    const receivedAnswer = await answerPromise;
    assert.strictEqual(receivedAnswer.answer.sdp, "dummy-answer-sdp");

    // ICE candidates are routed accurately
    const hostCandidatePromise = new Promise((resolve) => {
      listenerSocket.once("signal:ice-candidate", resolve);
    });

    hostSocket.emit("signal:ice-candidate", {
      roomId: session.roomId,
      targetId: "listener-sig-1",
      candidate: { candidate: "candidate:1 1 UDP ...", sdpMid: "0" },
      senderId: "host-sig-1"
    });

    const receivedCandidate = await hostCandidatePromise;
    assert.strictEqual(receivedCandidate.candidate.sdpMid, "0");
  } finally {
    hostSocket.disconnect();
    listenerSocket.disconnect();
    await new Promise((res) => server.close(res));
  }
});

test("Listener Lifecycle: repeated join and clean departure does not leak presence", async () => {
  const { server } = createTestServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const serverUrl = `http://localhost:${port}`;

  clearAllSessionsForTesting();
  const session = createSession({
    hostId: "host-leak-1",
    hostName: "Clean Host",
    title: "No Leaks",
    category: "Music"
  });

  const listenerSocket = ioClient(serverUrl, { transports: ["websocket"] });

  try {
    await waitForConnect(listenerSocket);

    for (let i = 0; i < 3; i++) {
      listenerSocket.emit("listener-joined-room", {
        roomId: session.roomId,
        listenerId: "listener-reuse",
        username: "Reuser"
      });
      await new Promise((r) => setTimeout(r, 60));
      assert.strictEqual(getRawSession(session.roomId).users.length, 1);

      listenerSocket.emit("listener-left-room", {
        roomId: session.roomId,
        listenerId: "listener-reuse"
      });
      await new Promise((r) => setTimeout(r, 60));
      assert.strictEqual(getRawSession(session.roomId).users.length, 0);
    }
  } finally {
    listenerSocket.disconnect();
    await new Promise((res) => server.close(res));
  }
});
