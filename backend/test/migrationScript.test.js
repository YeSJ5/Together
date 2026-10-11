const assert = require("node:assert");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { sanitizeConnectionString, runMigration } = require("../scripts/migrateSqliteToPg");

test("Migration Script: Redacts connection strings with passwords", () => {
  const sanitized = sanitizeConnectionString("postgresql://admin:superSecret123@db.render.com:5432/together");
  assert.strictEqual(sanitized.includes("superSecret123"), false);
  assert.ok(sanitized.includes("REDACTED"));
});

test("Migration Script: Performs pre-migration backup and dry-run verification", async () => {
  const result = await runMigration({ dryRun: true });
  assert.strictEqual(result.success, true);
  assert.ok(result.backupFile);
  assert.ok(fs.existsSync(result.backupFile), "Backup snapshot file must be created on disk");

  const backupData = JSON.parse(fs.readFileSync(result.backupFile, "utf8"));
  assert.ok(backupData.counts);
  assert.ok(Array.isArray(backupData.rooms));
  assert.ok(Array.isArray(backupData.userProfiles));

  // Cleanup test backup
  try {
    fs.unlinkSync(result.backupFile);
  } catch (_e) {}
});
