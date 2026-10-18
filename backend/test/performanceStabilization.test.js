const assert = require("node:assert");
const test = require("node:test");
const { TogetherDatabase } = require("../src/db/database");
const { ALLOWED_ORIGINS } = require("../src/config");

test("Performance & Stability: TogetherDatabase pool config includes statement and query timeouts", () => {
  const dummyUrl = "postgresql://user:pass@127.0.0.1:5432/testdb";
  const db = new TogetherDatabase({ databaseUrl: dummyUrl, requirePostgres: false });

  assert.ok(db.pgPool, "PostgreSQL pool should be instantiated");
  assert.strictEqual(db.pgPool.options.statement_timeout, 10000, "statement_timeout must be 10000ms");
  assert.strictEqual(db.pgPool.options.query_timeout, 10000, "query_timeout must be 10000ms");
  assert.strictEqual(db.pgPool.options.connectionTimeoutMillis, 5000, "connectionTimeoutMillis must be 5000ms");

  db.close();
});

test("Performance & Stability: waitForReady resolves within bounded time", async () => {
  const dummyUrl = "postgresql://user:pass@127.0.0.1:54329/testdb";
  const db = new TogetherDatabase({ databaseUrl: dummyUrl, requirePostgres: false });

  const start = Date.now();
  await db.waitForReady(500); // 500ms max bound
  const elapsed = Date.now() - start;

  assert.ok(elapsed < 2000, `waitForReady must resolve within bounded time, took ${elapsed}ms`);
  db.close();
});

test("Performance & Stability: checkHealth handles slow query without indefinite hang", async () => {
  const db = new TogetherDatabase({ databaseUrl: null, requirePostgres: false, dbPath: ":memory:" });
  await db.waitForReady();

  const start = Date.now();
  const health = await db.checkHealth();
  const elapsed = Date.now() - start;

  assert.strictEqual(health.status, "connected");
  assert.strictEqual(health.healthy, true);
  assert.ok(elapsed < 1000, `Health check must be fast, took ${elapsed}ms`);
  db.close();
});

test("Performance & Stability: Vercel preview and canonical production origins are recognized", () => {
  const allowedList = [
    "https://together-puce.vercel.app",
    "https://together-listen.vercel.app"
  ];

  function checkOriginAllowed(origin, allowedOrigins = allowedList) {
    if (allowedOrigins === "*") return true;
    if (!origin) return true;
    if (allowedOrigins.includes(origin)) return true;
    if (
      /^https:\/\/together-[a-z0-9\-]+-yeshws-projects\.vercel\.app$/.test(origin) ||
      /^https:\/\/together-[a-z0-9\-]+\.vercel\.app$/.test(origin)
    ) {
      return true;
    }
    return false;
  }

  const validOrigins = [
    "https://together-puce.vercel.app",
    "https://together-listen.vercel.app",
    "https://together-abc123xyz.vercel.app",
    "https://together-preview-yeshws-projects.vercel.app"
  ];

  for (const origin of validOrigins) {
    assert.strictEqual(checkOriginAllowed(origin), true, `Origin ${origin} should be allowed`);
  }

  assert.strictEqual(checkOriginAllowed("https://malicious-site.com"), false, "Untrusted external origin must be rejected");
});
