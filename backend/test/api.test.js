const assert = require("node:assert");
const test = require("node:test");
const http = require("node:http");

// We test against our sessionStore directly or start an ephemeral express instance
const express = require("express");
const {
  createSession,
  getSession,
  deleteSession,
  listActivePublicSessions,
  updateSession
} = require("../src/sessionStore");

test("Integration API routes and session lifecycle", async () => {
  const app = express();
  app.use(express.json());

  app.get("/api/health", (_req, res) => res.json({ product: "TOGETHER", status: "ok" }));
  app.get("/api/rooms", (_req, res) => res.json({ rooms: listActivePublicSessions() }));
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
    const { currentTrack } = req.body || {};
    const updated = updateSession(req.params.id, (draft) => {
      draft.currentTrack = currentTrack;
    });
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  });
  app.delete("/session/:id", (req, res) => {
    const deleted = deleteSession(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Not found" });
    res.json({ message: "Deleted", session: deleted });
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Health check
    const healthRes = await fetch(`${baseUrl}/api/health`);
    const healthJson = await healthRes.json();
    assert.strictEqual(healthJson.status, "ok");

    // 2. Create session
    const createRes = await fetch(`${baseUrl}/create-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hostId: "host-live-99",
        hostName: "DJ Starlight",
        title: "Ambient Sunset Lo-Fi",
        category: "Music"
      })
    });
    assert.strictEqual(createRes.status, 201);
    const session = await createRes.json();
    assert.ok(session.roomId);
    assert.strictEqual(session.title, "Ambient Sunset Lo-Fi");

    // 3. Fetch public rooms
    const roomsRes = await fetch(`${baseUrl}/api/rooms`);
    const roomsJson = await roomsRes.json();
    assert.ok(Array.isArray(roomsJson.rooms));
    const found = roomsJson.rooms.find((r) => r.roomId === session.roomId);
    assert.ok(found, "Created session must be in public rooms list");

    // 4. Update track
    const trackRes = await fetch(`${baseUrl}/session/${session.roomId}/track`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentTrack: { title: "Resonance", artist: "HOME" }
      })
    });
    const trackJson = await trackRes.json();
    assert.strictEqual(trackJson.currentTrack.title, "Resonance");

    // 5. Get session
    const getRes = await fetch(`${baseUrl}/session/${session.roomId}`);
    const getJson = await getRes.json();
    assert.strictEqual(getJson.currentTrack.artist, "HOME");

    // 6. Delete session
    const delRes = await fetch(`${baseUrl}/session/${session.roomId}`, {
      method: "DELETE"
    });
    assert.strictEqual(delRes.status, 200);

    // 7. Verify session gone
    const verifyRes = await fetch(`${baseUrl}/session/${session.roomId}`);
    assert.strictEqual(verifyRes.status, 404);
  } finally {
    server.close();
  }
});
