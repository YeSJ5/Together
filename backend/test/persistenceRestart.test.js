const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { TogetherDatabase } = require("../src/db/database");
const {
  createSession,
  getSession,
  updateSession,
  deleteSession,
  listActivePublicSessions,
  listActivePublicSessionsAsync,
  verifyHostKey,
  setHostConnected,
  getRawSession,
  clearAllSessionsForTesting,
  hydrateSessionsFromDatabase,
  setDatabaseForTesting,
  getDatabase
} = require("../src/sessionStore");

const TEST_DB_PATH = path.join(__dirname, `test-restart-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`);

function cleanupTestFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    const jsonPath = filePath.replace(".sqlite", ".json");
    if (fs.existsSync(jsonPath)) {
      fs.unlinkSync(jsonPath);
    }
  } catch (_e) {}
}

test("Persistence & Restart: Lifecycle across process teardown, hydration, host re-auth, and duplicate prevention", async (t) => {
  cleanupTestFile(TEST_DB_PATH);
  const origDb = getDatabase();

  t.after(() => {
    setDatabaseForTesting(origDb);
    cleanupTestFile(TEST_DB_PATH);
  });

  // 1. PHASE 1: Initial process lifetime - Room Creation and Initial Persistence
  const db1 = new TogetherDatabase({ dbPath: TEST_DB_PATH });
  await db1.waitForReady();
  setDatabaseForTesting(db1);

  const session = createSession({
    hostId: "host-alex-99",
    hostName: "DJ Alex",
    title: "Saturday Sunset Session",
    category: "Music",
    isPublic: true
  });

  const roomId = session.roomId;
  const originalHostKey = session.hostKey;
  assert.ok(roomId.startsWith("ROOM-"));
  assert.ok(originalHostKey);

  // Update track state before restart
  const track = {
    title: "Sunset Boulevard",
    artist: "Synthwave Master",
    duration: 310,
    position: 72,
    isPlaying: true
  };
  updateSession(roomId, (draft) => {
    draft.currentTrack = track;
  });

  // Confirm room is active and present in memory and database
  const inMemoryBeforeRestart = getSession(roomId);
  assert.strictEqual(inMemoryBeforeRestart.title, "Saturday Sunset Session");
  assert.deepStrictEqual(inMemoryBeforeRestart.currentTrack, track);

  // 2. PHASE 2: Process Termination Simulation
  // Destroy first database connection and wipe all in-memory application maps
  db1.close();
  clearAllSessionsForTesting();

  // 3. PHASE 3: Process Restart Simulation
  // Create brand new database connection pointing to the same persistent store
  const db2 = new TogetherDatabase({ dbPath: TEST_DB_PATH });
  await db2.waitForReady();
  setDatabaseForTesting(db2);

  // Run startup stale cleanup and hydration
  db2.cleanupStaleRooms();
  await hydrateSessionsFromDatabase();

  // Hydrate sessions from persistent store
  const persistedRooms = db2.listAllActiveRooms();
  assert.strictEqual(persistedRooms.length, 1, "Exactly one room should exist in persistent database");

  const restoredDbRow = persistedRooms[0];
  assert.strictEqual(restoredDbRow.roomId, roomId);
  assert.strictEqual(restoredDbRow.title, "Saturday Sunset Session");
  assert.strictEqual(restoredDbRow.hostKey, originalHostKey, "Persistent hostKey must survive process restart");
  assert.deepStrictEqual(restoredDbRow.currentTrack, track, "Current track state must survive process restart");

  // Verify in-memory restored session properties
  const rawRestored = getRawSession(roomId);
  assert.ok(rawRestored, "Session must be loaded into memory");
  assert.strictEqual(rawRestored.hostConnected, false, "CRITICAL: Host must NOT be falsely marked as connected after restart");
  assert.strictEqual(rawRestored.restoredFromDb, true, "Session must be flagged as restored from database");
  assert.deepStrictEqual(rawRestored.users, [], "Listeners/sockets must be reset to empty on restart");

  // 4. PHASE 4: Presence & Broadcast Isolation
  // Unconnected restored room must NOT be advertised in public broadcast lists
  const publicBeforeReconnect = listActivePublicSessions();
  assert.strictEqual(
    publicBeforeReconnect.some((r) => r.roomId === roomId),
    false,
    "Restored room without active host must NOT appear in public active broadcast listing"
  );

  // 5. PHASE 5: Security & Authorization on Restored Room
  assert.strictEqual(verifyHostKey(roomId, "malicious-fake-key"), false, "Fake host key must be rejected");
  assert.strictEqual(verifyHostKey(roomId, null), false, "Missing host key must be rejected");
  assert.strictEqual(verifyHostKey(roomId, originalHostKey), true, "Legitimate host key must be verified");

  // 6. PHASE 6: Authorized Host Reconnection
  // Authorized host reconnects with original host key
  setHostConnected(roomId, true);
  rawRestored.hostConnected = true;

  // Now the room must be advertised as an active live broadcast
  const publicAfterReconnect = listActivePublicSessions();
  assert.strictEqual(
    publicAfterReconnect.some((r) => r.roomId === roomId),
    true,
    "Room must be advertised once authorized host reconnects"
  );

  // 7. PHASE 7: Repeated Restart Simulation (Prevent Duplicates)
  db2.close();
  clearAllSessionsForTesting();

  const db3 = new TogetherDatabase({ dbPath: TEST_DB_PATH });
  await db3.waitForReady();
  setDatabaseForTesting(db3);
  await hydrateSessionsFromDatabase();

  const repeatedRooms = db3.listAllActiveRooms();
  assert.strictEqual(repeatedRooms.length, 1, "Repeated restarts must never create duplicate rooms");
  assert.strictEqual(repeatedRooms[0].roomId, roomId);

  // 8. PHASE 8: Clean Session Termination & Lifecycle Rules
  // Host ends room
  deleteSession(roomId);
  const endedRow = db3.getRoom(roomId);
  assert.strictEqual(endedRow.status, "ended");
  assert.ok(endedRow.endedAt);

  // Restart again: ended room must NOT be restored
  db3.close();
  clearAllSessionsForTesting();

  const db4 = new TogetherDatabase({ dbPath: TEST_DB_PATH });
  await db4.waitForReady();
  setDatabaseForTesting(db4);
  await hydrateSessionsFromDatabase();

  const activeAfterEnd = db4.listAllActiveRooms();
  assert.strictEqual(activeAfterEnd.length, 0, "Ended rooms must NOT be returned by listAllActiveRooms");
  assert.strictEqual(getSession(roomId), null, "Ended room must not be retrievable as active session");

  db4.close();
});

test("Persistence & Restart: Stale room cleanup (>24h) marks abandoned rooms as ended", async () => {
  const staleDbPath = path.join(__dirname, `test-stale-${Date.now()}.sqlite`);
  cleanupTestFile(staleDbPath);

  try {
    const db = new TogetherDatabase({ dbPath: staleDbPath });
    await db.waitForReady();

    const staleCreatedAt = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
    db.upsertRoom({
      roomId: "ROOM-STALE-1",
      title: "Abandoned Room",
      category: "General",
      isPublic: true,
      hostId: "stale-host",
      hostName: "Stale Host",
      status: "active",
      createdAt: staleCreatedAt
    });

    const activeBeforeCleanup = db.listAllActiveRooms();
    assert.strictEqual(activeBeforeCleanup.length, 1);

    // Run stale cleanup
    db.cleanupStaleRooms();

    const activeAfterCleanup = db.listAllActiveRooms();
    assert.strictEqual(activeAfterCleanup.length, 0, "Stale room (>24h) must be marked ended and not active");

    const staleRoom = db.getRoom("ROOM-STALE-1");
    assert.strictEqual(staleRoom.status, "ended");
    assert.ok(staleRoom.endedAt);

    db.close();
  } finally {
    cleanupTestFile(staleDbPath);
  }
});
