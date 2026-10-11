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

test("database: TogetherDatabase health reporting, storage type detection, and graceful degradation", async () => {
  const { TogetherDatabase } = require("../src/db/database");

  // 1. In-memory SQLite instance
  const testDb = new TogetherDatabase({ dbPath: ":memory:" });
  const health = await testDb.checkHealth();
  assert.strictEqual(health.status, "connected");
  assert.strictEqual(health.healthy, true);
  assert.strictEqual(health.driver, "sqlite");
  assert.ok(["local-disk", "ephemeral-container"].includes(health.storageType));

  // 2. Room CRUD in database directly
  testDb.upsertRoom({
    roomId: "ROOM-DBTEST",
    title: "Database Test Room",
    category: "Study",
    isPublic: true,
    hostId: "host-db-1",
    hostName: "DB Host",
    status: "active"
  });

  const retrieved = testDb.getRoom("ROOM-DBTEST");
  assert.ok(retrieved);
  assert.strictEqual(retrieved.title, "Database Test Room");

  const publicRooms = testDb.listPublicActiveRooms();
  assert.ok(publicRooms.some((r) => r.roomId === "ROOM-DBTEST"));

  testDb.deleteOrEndRoom("ROOM-DBTEST");
  const ended = testDb.getRoom("ROOM-DBTEST");
  assert.strictEqual(ended.status, "ended");

  testDb.close();

  // 3. Degraded reporting when database is closed or disconnected
  const degradedHealth = await testDb.checkHealth();
  assert.strictEqual(degradedHealth.healthy, false);
  assert.strictEqual(degradedHealth.status, "degraded");
});

test("sessionStore: historical restored rooms do not appear as active broadcasts until host reconnects", async () => {
  const {
    createSession,
    getSession,
    setHostConnected,
    listActivePublicSessions,
    listActivePublicSessionsAsync,
    clearAllSessionsForTesting,
    deleteSession
  } = require("../src/sessionStore");

  const session = createSession({
    hostId: "host-historical-1",
    hostName: "Historical DJ",
    title: "Old Broadcast",
    category: "Music",
    isPublic: true
  });
  const roomId = session.roomId;

  // Simulate server restart: clear memory
  clearAllSessionsForTesting();

  // Initially after restart, restored from DB, host is not connected:
  const restored = getSession(roomId);
  assert.ok(restored, "Room metadata is preserved in database");

  // Both sync and async public lists must NOT advertise it as an active broadcast
  const syncList = listActivePublicSessions();
  assert.strictEqual(syncList.some((r) => r.roomId === roomId), false, "Historical restored room must NOT be advertised in sync list without active host");

  const asyncList = await listActivePublicSessionsAsync();
  assert.strictEqual(asyncList.some((r) => r.roomId === roomId), false, "Historical restored room must NOT be advertised in async list without active host");

  // Host connects / presence restored:
  setHostConnected(roomId, true);

  const activeSync = listActivePublicSessions();
  assert.strictEqual(activeSync.some((r) => r.roomId === roomId), true, "Room appears in sync list once host connects");

  const activeAsync = await listActivePublicSessionsAsync();
  assert.strictEqual(activeAsync.some((r) => r.roomId === roomId), true, "Room appears in async list once host connects");

  deleteSession(roomId);
});


