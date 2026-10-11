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

test("Security & Hardening: Malformed/non-string host keys rejected and source updates protected", async () => {
  const session = createSession({
    hostId: "host-strict-1",
    hostName: "Strict Host",
    title: "Hardened Room",
    category: "Podcast"
  });

  const roomId = session.roomId;
  const validKey = session.hostKey;

  // 1. Non-string candidate keys must fail timingSafeEqual safely without exception
  assert.strictEqual(verifyHostKey(roomId, null), false);
  assert.strictEqual(verifyHostKey(roomId, undefined), false);
  assert.strictEqual(verifyHostKey(roomId, ""), false);
  assert.strictEqual(verifyHostKey(roomId, "   "), false);
  assert.strictEqual(verifyHostKey(roomId, 12345), false);
  assert.strictEqual(verifyHostKey(roomId, {}), false);
  assert.strictEqual(verifyHostKey(roomId, []), false);
  assert.strictEqual(verifyHostKey(roomId, { hostKey: validKey }), false);

  // 2. Length mismatch must fail safely
  assert.strictEqual(verifyHostKey(roomId, validKey.slice(0, 10)), false);
  assert.strictEqual(verifyHostKey(roomId, validKey + "extra"), false);

  // 3. Exact valid string succeeds
  assert.strictEqual(verifyHostKey(roomId, validKey), true);

  deleteSession(roomId);
});

test("Security & Proxy Isolation: Rate limiting discriminates independent client IPs behind reverse proxy", async () => {
  const app = express();
  app.set("trust proxy", 1);

  const proxyLimiter = createRateLimiter({
    windowMs: 5000,
    maxRequests: 2,
    message: "Rate limit exceeded"
  });

  app.get("/proxy-test", proxyLimiter, (req, res) => {
    res.json({ clientIp: req.ip });
  });

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const ip1Headers = { "x-test-ratelimit": "true", "x-forwarded-for": "203.0.113.19" };
    const ip2Headers = { "x-test-ratelimit": "true", "x-forwarded-for": "198.51.100.42" };

    // Client 1 sends 2 requests (exhausts allowance)
    const r1 = await fetch(`${baseUrl}/proxy-test`, { headers: ip1Headers });
    assert.strictEqual(r1.status, 200);
    const r2 = await fetch(`${baseUrl}/proxy-test`, { headers: ip1Headers });
    assert.strictEqual(r2.status, 200);

    // Client 1 is now throttled
    const r3 = await fetch(`${baseUrl}/proxy-test`, { headers: ip1Headers });
    assert.strictEqual(r3.status, 429, "Client 1 must be throttled");

    // Client 2 with different IP behind the proxy is NOT throttled
    const r4 = await fetch(`${baseUrl}/proxy-test`, { headers: ip2Headers });
    assert.strictEqual(r4.status, 200, "Client 2 must have an independent rate limit bucket");
  } finally {
    server.close();
  }
});

