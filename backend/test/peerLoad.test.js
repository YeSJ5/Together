const assert = require("node:assert");
const test = require("node:test");
const http = require("node:http");
const express = require("express");
const { Server } = require("socket.io");
const { io: ioClient } = require("socket.io-client");
const { createSession, deleteSession } = require("../src/sessionStore");

test("Peer Capacity Benchmark: 20 concurrent listeners in mesh room signaling", async () => {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: "*" } });

  io.on("connection", (socket) => {
    socket.on("join-bench", ({ roomId, userId }) => {
      socket.join(roomId);
      io.to(roomId).emit("user-joined", { userId });
    });
    socket.on("signal-ping", ({ roomId, seq }) => {
      socket.to(roomId).emit("signal-pong", { seq, timestamp: Date.now() });
    });
  });

  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  const session = createSession({
    hostId: "host-bench-1",
    hostName: "Bench Host",
    title: "Capacity Test Stage"
  });
  const roomId = session.roomId;

  const CONCURRENT_CLIENTS = 20;
  const clients = [];

  const startTime = Date.now();

  try {
    // Connect host
    const host = ioClient(`http://127.0.0.1:${port}`, { transports: ["websocket"], forceNew: true });
    clients.push(host);
    await new Promise((r) => host.on("connect", r));
    host.emit("join-bench", { roomId, userId: "host" });

    // Connect 20 listeners concurrently
    const joinPromises = [];
    for (let i = 1; i <= CONCURRENT_CLIENTS; i++) {
      const client = ioClient(`http://127.0.0.1:${port}`, { transports: ["websocket"], forceNew: true });
      clients.push(client);
      joinPromises.push(
        new Promise((resolve) => {
          client.on("connect", () => {
            client.emit("join-bench", { roomId, userId: `listener-${i}` });
            resolve();
          });
        })
      );
    }

    await Promise.all(joinPromises);
    const connectionDuration = Date.now() - startTime;

    // Verify broadcast signaling latency to all 20 listeners
    const latencyPromises = clients.slice(1).map((client) => {
      return new Promise((resolve) => {
        client.once("signal-pong", (data) => {
          resolve(Date.now() - data.timestamp);
        });
      });
    });

    host.emit("signal-ping", { roomId, seq: 1 });
    const latencies = await Promise.all(latencyPromises);
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;

    assert.ok(connectionDuration < 5000, `Connection time for 20 clients should be under 5s (got ${connectionDuration}ms)`);
    assert.ok(avgLatency < 500, `Average signaling broadcast latency should be under 500ms (got ${avgLatency}ms)`);

    console.log(`[Bench] 20 concurrent mesh listeners connected in ${connectionDuration}ms, avg signaling latency: ${avgLatency.toFixed(1)}ms`);

    deleteSession(roomId);
  } finally {
    clients.forEach((c) => c.disconnect());
    io.close();
    server.close();
  }
});
