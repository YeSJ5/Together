const assert = require("node:assert");
const test = require("node:test");
const {
  createSession,
  getSession,
  updateSession,
  deleteSession,
  listActivePublicSessions
} = require("../src/sessionStore");

test("sessionStore: creates, lists, updates, and deletes sessions", () => {
  const session = createSession({
    hostId: "host-test-123",
    hostName: "Test DJ",
    title: "Vibes & Beats",
    category: "Music",
    isPublic: true
  });

  assert.ok(session.roomId.startsWith("ROOM-"));
  assert.strictEqual(session.hostName, "Test DJ");
  assert.strictEqual(session.title, "Vibes & Beats");
  assert.strictEqual(session.category, "Music");
  assert.strictEqual(session.isPublic, true);

  // Listing public sessions
  const publicRooms = listActivePublicSessions();
  const found = publicRooms.find((r) => r.roomId === session.roomId);
  assert.ok(found, "Created session should appear in public rooms");

  // Update track
  const updated = updateSession(session.roomId, (draft) => {
    draft.currentTrack = {
      title: "Midnight City",
      artist: "M83",
      duration: 240,
      position: 45,
      isPlaying: true
    };
  });
  assert.strictEqual(updated.currentTrack.title, "Midnight City");

  // Get session
  const retrieved = getSession(session.roomId);
  assert.strictEqual(retrieved.currentTrack.artist, "M83");

  // Delete session
  const deleted = deleteSession(session.roomId);
  assert.strictEqual(deleted.roomId, session.roomId);
  assert.strictEqual(getSession(session.roomId), null);
});

test("sessionStore: restores room from durable database on process reload", () => {
  const session = createSession({
    hostId: "host-persist-1",
    hostName: "Resilient DJ",
    title: "Persistent Broadcast",
    category: "Podcast",
    isPublic: true
  });

  const roomId = session.roomId;
  assert.ok(roomId);

  // Simulate process restart by clearing in-memory Map
  const { clearAllSessionsForTesting, getDatabase } = require("../src/sessionStore");
  clearAllSessionsForTesting();

  // getSession should restore from durable SQLite storage
  const restored = getSession(roomId);
  assert.ok(restored, "Session should be restored from durable database");
  assert.strictEqual(restored.roomId, roomId);
  assert.strictEqual(restored.title, "Persistent Broadcast");
  assert.strictEqual(restored.hostName, "Resilient DJ");
  assert.strictEqual(restored.status, "active");

  // Check user profile was saved
  const db = getDatabase();
  const profile = db.getUserProfile("host-persist-1");
  assert.ok(profile);
  assert.strictEqual(profile.username, "Resilient DJ");

  deleteSession(roomId);
});

