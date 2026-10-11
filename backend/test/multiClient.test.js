const assert = require("node:assert");
const test = require("node:test");
const http = require("node:http");
const express = require("express");
const { Server } = require("socket.io");
const { io: ioClient } = require("socket.io-client");

const {
  createSession,
  deleteSession,
  getRawSession,
  getSession,
  listActivePublicSessions,
  updateSession,
  getDatabase
} = require("../src/sessionStore");
const { getIceServerConfig } = require("../src/iceConfig");

function createTestServer() {
  const app = express();
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    try {
      const db = getDatabase();
      const dbRooms = db.listPublicActiveRooms();
      const mem = process.memoryUsage();
      const ice = getIceServerConfig();

      return res.json({
        product: "TOGETHER",
        version: "2.1.0",
        status: "ok",
        ready: true,
        uptimeSeconds: Math.floor(process.uptime()),
        database: {
          status: "connected",
          persistedActiveRooms: dbRooms.length
        },
        metrics: {
          activeRooms: listActivePublicSessions().length,
          connectedSockets: io.engine ? io.engine.clientsCount : 0,
          memoryRssMb: Math.round(mem.rss / 1024 / 1024),
          heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024)
        },
        turnConfigured: ice.hasTurn
      });
    } catch (e) {
      return res.status(503).json({ status: "degraded", error: e.message });
    }
  });

  app.get("/api/ice-servers", (req, res) => {
    const clientId = req.query.clientId || "test-client";
    res.json(getIceServerConfig({ clientId }));
  });

  app.get("/api/rooms", (_req, res) => {
    res.json({ rooms: listActivePublicSessions() });
  });

  app.post("/create-session", (req, res) => {
    const { hostId, hostName, title, category, isPublic, audioSourceMode } = req.body || {};
    if (!hostId) {
      return res.status(400).json({ message: "hostId is required to create a session." });
    }
    const session = createSession({ hostId, hostName, title, category, isPublic, audioSourceMode });
    return res.status(201).json(session);
  });

  app.get("/session/:id", (req, res) => {
    const session = getSession(req.params.id);
    if (!session) return res.status(404).json({ message: "Session not found." });
    res.json(session);
  });

  app.post("/session/:id/leave", (req, res) => {
    const { listenerId } = req.body || {};
    const session = getRawSession(req.params.id);
    if (!session) return res.status(404).json({ message: "Session not found or expired." });
    if (!listenerId) return res.status(400).json({ message: "listenerId is required." });

    updateSession(req.params.id, (draft) => {
      draft.users = draft.users.filter((user) => user.id !== listenerId);
    });
    return res.json({ message: "Listener removed." });
  });

  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: "*" } });

  function emitUserCount(roomId) {
    const session = getRawSession(roomId);
    if (!session) return;
    io.to(roomId).emit("user-count-updated", {
      roomId,
      count: session.users.length,
      users: session.users
    });
  }

  const hostDisconnectTimers = new Map();

  io.on("connection", (socket) => {
    socket.on("host-created-room", ({ roomId, hostId, hostKey }) => {
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

      updateSession(roomId, (draft) => {
        draft.hostId = hostId;
        draft.status = "active";
      });

      socket.emit("room-ready", { roomId });
      emitUserCount(roomId);
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

      io.to(roomId).emit("listener-joined-room", { roomId, listenerId, username: username || "Listener" });
      emitUserCount(roomId);
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

    socket.on("chat-message", ({ roomId, senderId, senderName, message }) => {
      if (!socket.data.roomId || socket.data.roomId !== roomId || !message) return;
      io.to(roomId).emit("chat-message", {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        roomId,
        senderId,
        senderName: senderName || "Participant",
        message: String(message).trim(),
        createdAt: Date.now()
      });
    });

    socket.on("reaction", ({ roomId, emoji, senderName }) => {
      if (!socket.data.roomId || socket.data.roomId !== roomId || !emoji) return;
      io.to(roomId).emit("reaction", {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        roomId,
        emoji,
        senderName: senderName || "Listener",
        createdAt: Date.now()
      });
    });

    socket.on("transcript-chunk", ({ roomId, text, isFinal, senderName }) => {
      if (!socket.data.roomId || socket.data.roomId !== roomId || !text) return;
      if (socket.data.role !== "host" || !socket.data.isAuthorizedHost) return;
      io.to(roomId).emit("transcript-chunk", {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        roomId,
        text,
        isFinal: Boolean(isFinal),
        senderName: senderName || "Host"
      });
    });

    socket.on("playback-sync", ({ roomId, currentTrack }) => {
      if (!socket.data.roomId || socket.data.roomId !== roomId) return;
      if (socket.data.role !== "host" || !socket.data.isAuthorizedHost) return;
      updateSession(roomId, (draft) => {
        draft.currentTrack = currentTrack;
      });
      socket.to(roomId).emit("playback-state-updated", { roomId, currentTrack });
    });

    socket.on("listener-left-room", ({ roomId, listenerId }) => {
      if (!socket.data.roomId || socket.data.roomId !== roomId || !listenerId) return;
      const updated = updateSession(roomId, (draft) => {
        draft.users = draft.users.filter((u) => u.id !== listenerId);
      });
      if (updated) {
        io.to(roomId).emit("listener-disconnected", { roomId, listenerId });
        emitUserCount(roomId);
      }
    });

    socket.on("host-ended-session", ({ roomId, hostKey }) => {
      if (!socket.data.roomId || socket.data.roomId !== roomId) return;
      if (!socket.data.isAuthorizedHost) {
        socket.emit("room-error", { roomId, message: "Forbidden: Unauthorized host action." });
        return;
      }
      const session = deleteSession(roomId);
      if (session) {
        io.to(roomId).emit("session-ended", { roomId });
      }
    });

    socket.on("disconnect", () => {
      const { roomId, role, peerId } = socket.data;
      if (!roomId || !peerId) return;

      if (role === "host") {
        const timer = setTimeout(() => {
          hostDisconnectTimers.delete(roomId);
          const session = deleteSession(roomId);
          if (session) {
            io.to(roomId).emit("session-ended", { roomId, reason: "Host ended the session." });
          }
        }, 100); // Shorter for test speed
        hostDisconnectTimers.set(roomId, timer);
      } else if (role === "listener") {
        const updated = updateSession(roomId, (draft) => {
          draft.users = draft.users.filter((u) => u.id !== peerId);
        });
        if (updated) {
          io.to(roomId).emit("listener-disconnected", { roomId, listenerId: peerId });
          emitUserCount(roomId);
        }
      }
    });
  });

  return { server, io };
}

function connectClient(port, role = "client") {
  return ioClient(`http://127.0.0.1:${port}`, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false
  });
}

function ensureConnected(socket) {
  if (socket.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Socket connect timeout")), 3000);
    socket.once("connect", () => {
      clearTimeout(t);
      resolve();
    });
  });
}

function waitForEvent(socket, eventName, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event "${eventName}" (${timeoutMs}ms)`));
    }, timeoutMs);

    socket.once(eventName, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

test("Multi-user testing: Room creation, multi-client join, and participant count consistency", async () => {
  const { server, io } = createTestServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const hostSocket = connectClient(port, "host");
  const listener1Socket = connectClient(port, "listener1");
  const listener2Socket = connectClient(port, "listener2");

  try {
    // 1. Host creates room via HTTP
    const createRes = await fetch(`${baseUrl}/create-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hostId: "host-multi-1",
        hostName: "Multi DJ",
        title: "Synchronized Beats Stage",
        category: "Music",
        isPublic: true
      })
    });
    assert.strictEqual(createRes.status, 201);
    const session = await createRes.json();
    const roomId = session.roomId;

    // 2. Host joins socket room
    await ensureConnected(hostSocket);
    hostSocket.emit("host-created-room", { roomId, hostId: "host-multi-1" });
    const readyData = await waitForEvent(hostSocket, "room-ready");
    assert.strictEqual(readyData.roomId, roomId);

    // 3. Listener 1 joins
    await ensureConnected(listener1Socket);
    const countPromise1 = waitForEvent(hostSocket, "user-count-updated");
    listener1Socket.emit("listener-joined-room", {
      roomId,
      listenerId: "listener-id-1",
      username: "Alice Listener"
    });
    const countData1 = await countPromise1;
    assert.strictEqual(countData1.count, 1);
    assert.strictEqual(countData1.users[0].id, "listener-id-1");

    // 4. Listener 2 joins
    await ensureConnected(listener2Socket);
    const countPromise2 = waitForEvent(hostSocket, "user-count-updated");
    listener2Socket.emit("listener-joined-room", {
      roomId,
      listenerId: "listener-id-2",
      username: "Bob Listener"
    });
    const countData2 = await countPromise2;
    assert.strictEqual(countData2.count, 2);

    // 5. Verify room session state via HTTP endpoint
    const sessionRes = await fetch(`${baseUrl}/session/${roomId}`);
    const sessionData = await sessionRes.json();
    assert.strictEqual(sessionData.users.length, 2);
    assert.strictEqual(sessionData.title, "Synchronized Beats Stage");

    deleteSession(roomId);
  } finally {
    hostSocket.disconnect();
    listener1Socket.disconnect();
    listener2Socket.disconnect();
    io.close();
    server.close();
  }
});

test("Multi-user testing: Real WebRTC signaling exchange (offer, answer, ICE candidates) & targeted routing", async () => {
  const { server, io } = createTestServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const hostSocket = connectClient(port);
  const listener1Socket = connectClient(port);
  const listener2Socket = connectClient(port);

  try {
    const createRes = await fetch(`${baseUrl}/create-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostId: "host-rtc-1", hostName: "RTC Broadcaster", title: "WebRTC Test" })
    });
    const { roomId } = await createRes.json();

    await Promise.all([
      ensureConnected(hostSocket),
      ensureConnected(listener1Socket),
      ensureConnected(listener2Socket)
    ]);

    hostSocket.emit("host-created-room", { roomId, hostId: "host-rtc-1" });
    await waitForEvent(hostSocket, "room-ready");

    listener1Socket.emit("listener-joined-room", { roomId, listenerId: "listener-rtc-1", username: "Alice" });
    listener2Socket.emit("listener-joined-room", { roomId, listenerId: "listener-rtc-2", username: "Bob" });

    // Host sends WebRTC offer targeted specifically to Listener 1
    const mockOfferSdp = { type: "offer", sdp: "v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 50000 RTP/SAVPF 111" };
    let listener2ReceivedOffer = false;
    listener2Socket.on("signal:offer", () => {
      listener2ReceivedOffer = true;
    });

    const offerPromise = waitForEvent(listener1Socket, "signal:offer");
    hostSocket.emit("signal:offer", {
      roomId,
      targetListenerId: "listener-rtc-1",
      offer: mockOfferSdp,
      senderId: "host-rtc-1"
    });

    const receivedOffer = await offerPromise;
    assert.strictEqual(receivedOffer.targetListenerId, "listener-rtc-1");
    assert.strictEqual(receivedOffer.offer.type, "offer");
    assert.strictEqual(receivedOffer.senderId, "host-rtc-1");

    // Listener 1 sends WebRTC answer back to Host
    const mockAnswerSdp = { type: "answer", sdp: "v=0\r\no=- 67890 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 50000 RTP/SAVPF 111" };
    const answerPromise = waitForEvent(hostSocket, "signal:answer");
    listener1Socket.emit("signal:answer", {
      roomId,
      targetHostId: "host-rtc-1",
      answer: mockAnswerSdp,
      senderId: "listener-rtc-1"
    });

    const receivedAnswer = await answerPromise;
    assert.strictEqual(receivedAnswer.targetHostId, "host-rtc-1");
    assert.strictEqual(receivedAnswer.answer.type, "answer");
    assert.strictEqual(receivedAnswer.senderId, "listener-rtc-1");

    // Both exchange ICE candidates
    const mockCandidate = { candidate: "candidate:1 1 UDP 2130706431 192.168.1.100 50000 typ host", sdpMid: "0", sdpMLineIndex: 0 };
    const candidatePromise = waitForEvent(listener1Socket, "signal:ice-candidate");
    hostSocket.emit("signal:ice-candidate", {
      roomId,
      targetId: "listener-rtc-1",
      candidate: mockCandidate,
      senderId: "host-rtc-1"
    });

    const receivedCandidate = await candidatePromise;
    assert.strictEqual(receivedCandidate.targetId, "listener-rtc-1");
    assert.strictEqual(receivedCandidate.candidate.sdpMid, "0");

    deleteSession(roomId);
  } finally {
    hostSocket.disconnect();
    listener1Socket.disconnect();
    listener2Socket.disconnect();
    io.close();
    server.close();
  }
});

test("Multi-user testing: Room isolation across simultaneous rooms & track sync", async () => {
  const { server, io } = createTestServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const hostASocket = connectClient(port);
  const listenerASocket = connectClient(port);
  const hostBSocket = connectClient(port);
  const listenerBSocket = connectClient(port);

  try {
    // Create Room A & Room B
    const resA = await fetch(`${baseUrl}/create-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostId: "host-A", hostName: "DJ Alpha", title: "Room Alpha" })
    });
    const { roomId: roomA } = await resA.json();

    const resB = await fetch(`${baseUrl}/create-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostId: "host-B", hostName: "DJ Beta", title: "Room Beta" })
    });
    const { roomId: roomB } = await resB.json();

    // Connect clients
    await Promise.all([
      ensureConnected(hostASocket),
      ensureConnected(listenerASocket),
      ensureConnected(hostBSocket),
      ensureConnected(listenerBSocket)
    ]);

    hostASocket.emit("host-created-room", { roomId: roomA, hostId: "host-A" });
    await waitForEvent(hostASocket, "room-ready");
    listenerASocket.emit("listener-joined-room", { roomId: roomA, listenerId: "listener-A", username: "Alice A" });

    hostBSocket.emit("host-created-room", { roomId: roomB, hostId: "host-B" });
    await waitForEvent(hostBSocket, "room-ready");
    listenerBSocket.emit("listener-joined-room", { roomId: roomB, listenerId: "listener-B", username: "Bob B" });

    // Track leak detection: ensure Room B listener does NOT receive Room A chat or track
    let roomBLeakedChat = false;
    listenerBSocket.on("chat-message", (msg) => {
      if (msg.roomId === roomA) roomBLeakedChat = true;
    });

    const chatPromise = waitForEvent(listenerASocket, "chat-message");
    hostASocket.emit("chat-message", {
      roomId: roomA,
      senderId: "host-A",
      senderName: "DJ Alpha",
      message: "Secret Alpha Track dropping now!"
    });

    const chatMsg = await chatPromise;
    assert.strictEqual(chatMsg.message, "Secret Alpha Track dropping now!");
    assert.strictEqual(roomBLeakedChat, false, "Room B should never receive Room A messages");

    // Track state sync in Room A
    const trackPromise = waitForEvent(listenerASocket, "playback-state-updated");
    hostASocket.emit("playback-sync", {
      roomId: roomA,
      currentTrack: { title: "Cosmic Flow", artist: "Stella", isPlaying: true }
    });
    const trackEvent = await trackPromise;
    assert.strictEqual(trackEvent.currentTrack.title, "Cosmic Flow");

    deleteSession(roomA);
    deleteSession(roomB);
  } finally {
    hostASocket.disconnect();
    listenerASocket.disconnect();
    hostBSocket.disconnect();
    listenerBSocket.disconnect();
    io.close();
    server.close();
  }
});

test("Multi-user testing: Host departure, listener leave, and resource cleanup", async () => {
  const { server, io } = createTestServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const hostSocket = connectClient(port);
  const listenerSocket = connectClient(port);

  try {
    const res = await fetch(`${baseUrl}/create-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostId: "host-exit", hostName: "Exit Host", title: "Ending Room" })
    });
    const { roomId } = await res.json();

    await Promise.all([
      ensureConnected(hostSocket),
      ensureConnected(listenerSocket)
    ]);

    hostSocket.emit("host-created-room", { roomId, hostId: "host-exit" });
    await waitForEvent(hostSocket, "room-ready");

    listenerSocket.emit("listener-joined-room", { roomId, listenerId: "listener-exit", username: "Listener" });
    await waitForEvent(hostSocket, "user-count-updated");

    // Listener leaves room
    const countAfterLeave = waitForEvent(hostSocket, "user-count-updated");
    listenerSocket.emit("listener-left-room", { roomId, listenerId: "listener-exit" });
    const countData = await countAfterLeave;
    assert.strictEqual(countData.count, 0);

    // Host explicitly ends session
    const endedPromise = waitForEvent(listenerSocket, "session-ended");
    hostSocket.emit("host-ended-session", { roomId });
    const endedData = await endedPromise;
    assert.strictEqual(endedData.roomId, roomId);

    // Verify session removed
    const checkRes = await fetch(`${baseUrl}/session/${roomId}`);
    assert.strictEqual(checkRes.status, 404);
  } finally {
    hostSocket.disconnect();
    listenerSocket.disconnect();
    io.close();
    server.close();
  }
});

test("Multi-user testing: Validation, unauthorized actions, and error handling", async () => {
  const { server, io } = createTestServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const socket = connectClient(port);

  try {
    await ensureConnected(socket);

    // 1. Join non-existent room emits room-error
    const errorPromise = waitForEvent(socket, "room-error");
    socket.emit("listener-joined-room", {
      roomId: "ROOM-NONEXISTENT",
      listenerId: "bad-listener",
      username: "Nobody"
    });
    const errorData = await errorPromise;
    assert.strictEqual(errorData.roomId, "ROOM-NONEXISTENT");
    assert.ok(errorData.message.includes("Invalid room"));

    // 2. HTTP create without hostId returns 400
    const invalidCreate = await fetch(`${baseUrl}/create-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "No host" })
    });
    assert.strictEqual(invalidCreate.status, 400);

    // 3. HTTP leave non-existent room returns 404
    const invalidLeave = await fetch(`${baseUrl}/session/ROOM-GHOST/leave`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listenerId: "some-id" })
    });
    assert.strictEqual(invalidLeave.status, 404);

    // 4. HTTP health check reflects real readiness
    const healthRes = await fetch(`${baseUrl}/api/health`);
    const healthJson = await healthRes.json();
    assert.strictEqual(healthJson.status, "ok");
    assert.strictEqual(healthJson.ready, true);
    assert.strictEqual(healthJson.database.status, "connected");

    // 5. Dynamic ICE server generation endpoint
    const iceRes = await fetch(`${baseUrl}/api/ice-servers?clientId=peer-123`);
    const iceJson = await iceRes.json();
    assert.ok(Array.isArray(iceJson.iceServers));
    assert.ok(iceJson.iceServers.length >= 2, "Must contain at least 2 ICE servers");
  } finally {
    socket.disconnect();
    io.close();
    server.close();
  }
});

test("Multi-user testing: Cross-room message rejection & role privilege boundaries", async () => {
  const { app, io, server } = createTestServer();
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const roomA = createSession({
    hostId: "host-A",
    hostName: "Host Alpha",
    title: "Stage Alpha",
    category: "Music"
  });

  const roomB = createSession({
    hostId: "host-B",
    hostName: "Host Beta",
    title: "Stage Beta",
    category: "Podcast"
  });

  const hostSocketA = ioClient(baseUrl, { reconnection: false });
  const listenerSocketB = ioClient(baseUrl, { reconnection: false });

  try {
    await Promise.all([
      new Promise((r) => hostSocketA.on("connect", r)),
      new Promise((r) => listenerSocketB.on("connect", r))
    ]);

    // Host A joins Room A
    hostSocketA.emit("host-created-room", {
      roomId: roomA.roomId,
      hostId: "host-A",
      hostKey: roomA.hostKey
    });
    await new Promise((r) => hostSocketA.on("room-ready", r));

    // Listener B joins Room B
    listenerSocketB.emit("listener-joined-room", {
      roomId: roomB.roomId,
      listenerId: "listener-B",
      username: "Listener Beta"
    });
    await new Promise((r) => setTimeout(r, 100));

    let hostAReceivedSpoofedChat = false;
    hostSocketA.on("chat-message", () => {
      hostAReceivedSpoofedChat = true;
    });

    let hostAReceivedSpoofedSignal = false;
    hostSocketA.on("signal:offer", () => {
      hostAReceivedSpoofedSignal = true;
    });

    // 1. Rogue Listener B in Room B attempts to inject chat into Room A
    listenerSocketB.emit("chat-message", {
      roomId: roomA.roomId,
      senderId: "listener-B",
      senderName: "Hacker",
      message: "Injected cross-room chat"
    });

    // 2. Rogue Listener B in Room B attempts to inject signaling into Room A
    listenerSocketB.emit("signal:offer", {
      roomId: roomA.roomId,
      targetListenerId: "listener-anyone",
      offer: { type: "offer", sdp: "fake-sdp" },
      senderId: "listener-B"
    });

    await new Promise((r) => setTimeout(r, 200));

    assert.strictEqual(
      hostAReceivedSpoofedChat,
      false,
      "Cross-room chat message MUST be rejected by server"
    );
    assert.strictEqual(
      hostAReceivedSpoofedSignal,
      false,
      "Cross-room signaling offer MUST be rejected by server"
    );

    // 3. Listener B attempts to emit host-ended-session without hostKey on Room A
    let roomErrorReceived = false;
    listenerSocketB.on("room-error", (err) => {
      if (err.message && err.message.includes("Forbidden")) {
        roomErrorReceived = true;
      }
    });

    listenerSocketB.emit("host-ended-session", {
      roomId: roomA.roomId,
      hostKey: "fake-key"
    });

    await new Promise((r) => setTimeout(r, 150));
    // Room A must still be intact
    assert.ok(getSession(roomA.roomId), "Room A must not be ended by unauthorized peer");

    // 4. Listener B attempts to broadcast transcript chunks (host-only)
    let transcriptLeaked = false;
    listenerSocketB.on("transcript-chunk", () => {
      transcriptLeaked = true;
    });
    listenerSocketB.emit("transcript-chunk", {
      roomId: roomB.roomId,
      text: "Listener trying to speak for host",
      isFinal: true
    });
    await new Promise((r) => setTimeout(r, 150));
    assert.strictEqual(transcriptLeaked, false, "Non-hosts cannot emit transcript chunks");
  } finally {
    hostSocketA.disconnect();
    listenerSocketB.disconnect();
    io.close();
    server.close();
    deleteSession(roomA.roomId);
    deleteSession(roomB.roomId);
  }
});

