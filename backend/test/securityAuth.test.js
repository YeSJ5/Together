const assert = require("node:assert");
const test = require("node:test");
const http = require("node:http");
const express = require("express");
const {
  createSession,
  deleteSession,
  getSession,
  verifyHostKey
} = require("../src/sessionStore");
const { createRateLimiter } = require("../src/rateLimiter");

test("Security & Authorization: Host key protection on privileged actions", async () => {
  const app = express();
  app.use(express.json());

  app.post("/create-session", (req, res) => {
    const { hostId, hostName, title, category } = req.body || {};
    if (!hostId) return res.status(400).json({ message: "hostId required" });
    const session = createSession({ hostId, hostName, title, category });
    res.status(201).json(session);
  });

  app.get("/session/:id", (req, res) => {
    const s = getSession(req.params.id);
    if (!s) return res.status(404).json({ message: "Not found" });
    res.json(s);
  });

  app.patch("/session/:id/track", (req, res) => {
    const hostKey = req.headers["x-host-key"] || req.body?.hostKey;
    if (!verifyHostKey(req.params.id, hostKey)) {
      return res.status(403).json({ message: "Forbidden: Invalid host key" });
    }
    res.json({ success: true });
  });

  app.delete("/session/:id", (req, res) => {
    const hostKey = req.headers["x-host-key"] || req.body?.hostKey;
    if (!verifyHostKey(req.params.id, hostKey)) {
      return res.status(403).json({ message: "Forbidden: Invalid host key" });
    }
    const deleted = deleteSession(req.params.id);
    res.json({ message: "Session ended", session: deleted });
  });

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Create session as host
    const createRes = await fetch(`${baseUrl}/create-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hostId: "host-sec-1",
        hostName: "Security DJ",
        title: "Protected Stage",
        category: "Music"
      })
    });
    assert.strictEqual(createRes.status, 201);
    const createdSession = await createRes.json();
    const roomId = createdSession.roomId;
    const validHostKey = createdSession.hostKey;

    assert.ok(validHostKey, "create-session response must include hostKey for the creator");

    // 2. Public getSession MUST NOT expose hostKey to listeners
    const publicRes = await fetch(`${baseUrl}/session/${roomId}`);
    const publicData = await publicRes.json();
    assert.strictEqual(publicData.hostKey, undefined, "Public session endpoint MUST NOT expose hostKey");

    // 3. Unauthorized attempt to patch track (no hostKey)
    const unauthorizedTrack = await fetch(`${baseUrl}/session/${roomId}/track`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentTrack: { title: "Hacked Track" } })
    });
    assert.strictEqual(unauthorizedTrack.status, 403, "Must return 403 Forbidden without hostKey");

    // 4. Unauthorized attempt to patch track (wrong hostKey)
    const badKeyTrack = await fetch(`${baseUrl}/session/${roomId}/track`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-host-key": "fake-host-key-attacker"
      },
      body: JSON.stringify({ currentTrack: { title: "Hacked Track" } })
    });
    assert.strictEqual(badKeyTrack.status, 403, "Must return 403 Forbidden with invalid hostKey");

    // 5. Authorized track patch with valid hostKey
    const validTrack = await fetch(`${baseUrl}/session/${roomId}/track`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-host-key": validHostKey
      },
      body: JSON.stringify({ currentTrack: { title: "Verified Track" } })
    });
    assert.strictEqual(validTrack.status, 200, "Must succeed with valid hostKey");

    // 6. Unauthorized attempt to delete/end session (hijack attempt)
    const unauthorizedDelete = await fetch(`${baseUrl}/session/${roomId}`, {
      method: "DELETE"
    });
    assert.strictEqual(unauthorizedDelete.status, 403, "Must return 403 Forbidden on unauthorized delete attempt");

    // 7. Authorized session end with valid hostKey
    const validDelete = await fetch(`${baseUrl}/session/${roomId}`, {
      method: "DELETE",
      headers: { "x-host-key": validHostKey }
    });
    assert.strictEqual(validDelete.status, 200, "Must succeed when valid hostKey is provided");
  } finally {
    server.close();
  }
});

test("Security & Abuse Controls: Rate limiting triggers 429 when threshold exceeded", async () => {
  const app = express();
  const testLimiter = createRateLimiter({
    windowMs: 1000,
    maxRequests: 3,
    message: "Rate limit exceeded"
  });

  app.get("/rate-limited-endpoint", testLimiter, (_req, res) => {
    res.json({ ok: true });
  });

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const headers = { "x-test-ratelimit": "true" };

    const res1 = await fetch(`${baseUrl}/rate-limited-endpoint`, { headers });
    assert.strictEqual(res1.status, 200);

    const res2 = await fetch(`${baseUrl}/rate-limited-endpoint`, { headers });
    assert.strictEqual(res2.status, 200);

    const res3 = await fetch(`${baseUrl}/rate-limited-endpoint`, { headers });
    assert.strictEqual(res3.status, 200);

    // 4th request must be throttled
    const res4 = await fetch(`${baseUrl}/rate-limited-endpoint`, { headers });
    assert.strictEqual(res4.status, 429, "4th request within 1s window must return 429 Too Many Requests");
    assert.ok(res4.headers.get("retry-after"), "Response must include Retry-After header");
  } finally {
    server.close();
  }
});
