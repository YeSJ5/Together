const assert = require("node:assert");
const test = require("node:test");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { Server: SocketIOServer } = require("socket.io");
const ioClient = require("socket.io-client");
const {
  createSession,
  getRawSession,
  clearAllSessionsForTesting
} = require("../src/sessionStore");

function createTestServer() {
  const server = http.createServer();
  const io = new SocketIOServer(server, {
    cors: { origin: "*" }
  });

  io.on("connection", (socket) => {
    socket.on("host-created-room", ({ roomId, hostId }) => {
      socket.data.role = "host";
      socket.data.roomId = roomId;
      socket.data.peerId = hostId;
      socket.join(roomId);
    });

    socket.on("listener-joined-room", ({ roomId, listenerId, username }) => {
      socket.data.role = "listener";
      socket.data.roomId = roomId;
      socket.data.peerId = listenerId;
      socket.join(roomId);

      io.to(roomId).emit("listener-joined-room", {
        roomId,
        listenerId,
        username: username || "Listener"
      });
    });

    socket.on("signal:offer", (data) => {
      socket.to(data.roomId).emit("signal:offer", data);
    });

    socket.on("signal:answer", (data) => {
      socket.to(data.roomId).emit("signal:answer", data);
    });

    socket.on("signal:ice-candidate", (data) => {
      socket.to(data.roomId).emit("signal:ice-candidate", data);
    });

    socket.on("listener-left-room", ({ roomId, listenerId }) => {
      io.to(roomId).emit("listener-disconnected", { roomId, listenerId });
    });
  });

  return { server, io };
}

function waitForConnect(socket) {
  return new Promise((resolve, reject) => {
    if (socket.connected) return resolve();
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
}

test("Regression: Host candidate pre-queueing stores candidates before answer arrives", async () => {
  const { server } = createTestServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const serverUrl = `http://localhost:${port}`;

  clearAllSessionsForTesting();
  const session = createSession({
    hostId: "host-reg-1",
    hostName: "Reg Host",
    title: "Candidate Prequeue",
    category: "Music"
  });

  const hostSocket = ioClient(serverUrl, { transports: ["websocket"] });
  const listenerSocket = ioClient(serverUrl, { transports: ["websocket"] });

  try {
    await Promise.all([waitForConnect(hostSocket), waitForConnect(listenerSocket)]);

    // Simulate host candidate queue
    const hostCandidateQueues = new Map();
    let remoteDescriptionSet = false;
    const addedCandidates = [];

    hostSocket.on("signal:ice-candidate", (data) => {
      if (!data?.candidate || !data.senderId) return;

      if (!remoteDescriptionSet) {
        if (!hostCandidateQueues.has(data.senderId)) {
          hostCandidateQueues.set(data.senderId, []);
        }
        hostCandidateQueues.get(data.senderId).push(data.candidate);
        return;
      }

      addedCandidates.push(data.candidate);
    });

    hostSocket.emit("host-created-room", {
      roomId: session.roomId,
      hostId: "host-reg-1"
    });

    // Listener sends candidate BEFORE answer arrives
    const earlyCandidate = { candidate: "candidate:early-1 1 UDP ...", sdpMid: "0" };
    listenerSocket.emit("signal:ice-candidate", {
      roomId: session.roomId,
      targetId: "host-reg-1",
      candidate: earlyCandidate,
      senderId: "listener-reg-1"
    });

    await new Promise((r) => setTimeout(r, 60));

    // Must be queued in hostCandidateQueues
    assert.ok(hostCandidateQueues.has("listener-reg-1"), "Early candidate must be queued under sender ID");
    assert.strictEqual(hostCandidateQueues.get("listener-reg-1").length, 1);
    assert.strictEqual(hostCandidateQueues.get("listener-reg-1")[0].candidate, earlyCandidate.candidate);

    // Now answer arrives and sets remote description
    remoteDescriptionSet = true;
    const queue = hostCandidateQueues.get("listener-reg-1");
    while (queue.length > 0) {
      addedCandidates.push(queue.shift());
    }

    assert.strictEqual(addedCandidates.length, 1, "Queued candidate must be drained into active connection");
    assert.strictEqual(queue.length, 0, "Queue must be empty after drain");
  } finally {
    hostSocket.disconnect();
    listenerSocket.disconnect();
    await new Promise((res) => server.close(res));
  }
});

test("Regression: Frontend bundle includes catch-all route and required chunks", () => {
  const distDir = path.resolve(__dirname, "../../frontend/dist/assets");
  assert.ok(fs.existsSync(distDir), "Production dist directory must exist");

  const files = fs.readdirSync(distDir);
  const indexChunk = files.find((f) => f.startsWith("index-") && f.endsWith(".js"));
  assert.ok(indexChunk, "Index bundle must exist");

  const indexContent = fs.readFileSync(path.join(distDir, indexChunk), "utf8");
  // Index chunk must contain react-router routing
  assert.ok(indexContent.includes("listen/") || indexContent.includes("host"), "Router paths must be compiled");
});
