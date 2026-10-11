const assert = require("node:assert");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { sanitizeConnectionString, runMigration, validateJsonField } = require("../scripts/migrateSqliteToPg");

test("Migration Script: Redacts connection strings with passwords", () => {
  const sanitized = sanitizeConnectionString("postgresql://admin:superSecret123@db.render.com:5432/together");
  assert.strictEqual(sanitized.includes("superSecret123"), false);
  assert.ok(sanitized.includes("REDACTED"));
});

test("Migration Script: Validates JSON field parsing and graceful null fallback", () => {
  assert.deepStrictEqual(validateJsonField('{"title":"Song A","artist":"Artist B"}'), { title: "Song A", artist: "Artist B" });
  assert.strictEqual(validateJsonField("not-a-valid-json"), null);
  assert.strictEqual(validateJsonField(null), null);
  assert.strictEqual(validateJsonField(undefined), null);
});

test("Migration Script: Performs pre-migration backup and dry-run verification without altering SQLite source", async () => {
  const sqlitePath = path.resolve(__dirname, "../data/together.sqlite");
  let originalMtime = null;
  if (fs.existsSync(sqlitePath)) {
    originalMtime = fs.statSync(sqlitePath).mtimeMs;
  }

  const result = await runMigration({ dryRun: true });
  assert.strictEqual(result.success, true);
  assert.ok(result.backupFile);
  assert.ok(fs.existsSync(result.backupFile), "Backup snapshot file must be created on disk");

  // Verify SQLite file was not touched or deleted
  if (originalMtime !== null) {
    assert.ok(fs.existsSync(sqlitePath), "SQLite database must not be deleted");
    assert.strictEqual(fs.statSync(sqlitePath).mtimeMs, originalMtime, "SQLite file must not be modified during export");
  }

  const backupData = JSON.parse(fs.readFileSync(result.backupFile, "utf8"));
  assert.strictEqual(backupData.version, "2.8.0");
  assert.ok(backupData.counts);
  assert.ok(Array.isArray(backupData.rooms));
  assert.ok(Array.isArray(backupData.userProfiles));
  assert.ok(Array.isArray(backupData.roomEvents));
  assert.strictEqual(backupData.counts.rooms, backupData.rooms.length);
  assert.strictEqual(backupData.counts.userProfiles, backupData.userProfiles.length);
  assert.strictEqual(backupData.counts.roomEvents, backupData.roomEvents.length);

  // Cleanup test backup
  try {
    fs.unlinkSync(result.backupFile);
  } catch (_e) {}
});
