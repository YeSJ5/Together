const assert = require("node:assert");
const test = require("node:test");
const { TogetherDatabase } = require("../src/db/database");

test("PostgreSQL Adapter: Missing DATABASE_URL falls back to SQLite for local development when REQUIRE_POSTGRES is false", async () => {
  const db = new TogetherDatabase({ databaseUrl: null, requirePostgres: false, dbPath: ":memory:" });
  await db.waitForReady();
  const health = await db.checkHealth();

  assert.strictEqual(health.status, "connected");
  assert.strictEqual(health.driver, "sqlite");
  assert.strictEqual(health.healthy, true);
  assert.ok(health.storageType);
  db.close();
});

test("PostgreSQL Adapter: REQUIRE_POSTGRES=true refuses SQLite fallback when DATABASE_URL is missing", async () => {
  const db = new TogetherDatabase({ databaseUrl: null, requirePostgres: true });
  await db.waitForReady();
  const health = await db.checkHealth();

  assert.strictEqual(health.status, "degraded");
  assert.strictEqual(health.driver, "postgresql");
  assert.strictEqual(health.storageType, "managed-cloud");
  assert.strictEqual(health.healthy, false);
  assert.ok(health.error.includes("REQUIRE_POSTGRES is enabled but DATABASE_URL is not configured"));
  db.close();
});

test("PostgreSQL Adapter: REQUIRE_POSTGRES=true refuses SQLite fallback when PostgreSQL connection fails", async () => {
  const unreachableUrl = "postgresql://bad_user:bad_pass@127.0.0.1:54329/bad_db";
  const db = new TogetherDatabase({ databaseUrl: unreachableUrl, requirePostgres: true });
  await db.waitForReady();
  const health = await db.checkHealth();

  assert.strictEqual(health.status, "degraded");
  assert.strictEqual(health.driver, "postgresql");
  assert.strictEqual(health.storageType, "managed-cloud");
  assert.strictEqual(health.healthy, false);
  assert.ok(health.error);
  assert.strictEqual(health.error.includes("bad_pass"), false, "Credentials must never be leaked");
  db.close();
});

test("PostgreSQL Adapter: Connection failure / invalid credentials reports degraded health without unhandled crash", async () => {
  const unreachableUrl = "postgresql://test_user:super_secret_pw@127.0.0.1:54329/test_db";
  const db = new TogetherDatabase({ databaseUrl: unreachableUrl, requirePostgres: false });

  // Await startup readiness
  await db.waitForReady();

  assert.strictEqual(db.getDriverName(), "postgresql");

  const health = await db.checkHealth();
  assert.strictEqual(health.status, "degraded");
  assert.strictEqual(health.driver, "postgresql");
  assert.strictEqual(health.storageType, "managed-cloud");
  assert.strictEqual(health.healthy, false);
  assert.ok(health.error, "Health check must record error description");
  assert.strictEqual(health.error.includes("super_secret_pw"), false, "Error message must never expose database password");

  db.close();
});

test("PostgreSQL Adapter: formatRoomRow safely deserializes valid JSON and handles malformed tracks", () => {
  const db = new TogetherDatabase({ databaseUrl: null, requirePostgres: false, dbPath: ":memory:" });

  const validRow = {
    room_id: "ROOM-TEST-1",
    title: "Test Room",
    category: "Music",
    is_public: 1,
    host_id: "host-1",
    host_name: "Host One",
    host_key: "key-123",
    audio_source_mode: "universal",
    media_backend: "webrtc-direct",
    status: "active",
    current_track: JSON.stringify({ title: "Song A", artist: "Artist B" }),
    livekit_room_name: null,
    native_mobile_recommended: 0,
    created_at: 1000,
    updated_at: 1100,
    ended_at: null
  };

  const formattedValid = db.formatRoomRow(validRow);
  assert.strictEqual(formattedValid.roomId, "ROOM-TEST-1");
  assert.deepStrictEqual(formattedValid.currentTrack, { title: "Song A", artist: "Artist B" });
  assert.strictEqual(formattedValid.isPublic, true);

  const malformedRow = {
    ...validRow,
    current_track: "not-json-content"
  };
  const formattedMalformed = db.formatRoomRow(malformedRow);
  assert.strictEqual(formattedMalformed.currentTrack, null, "Malformed current_track must safely fall back to null");

  db.close();
});
