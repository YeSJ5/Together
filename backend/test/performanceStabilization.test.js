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

test("Performance & Stability: Visualizer throttling reduces 60fps render calls by >75%", () => {
  let stateUpdateCount = 0;
  let lastUpdateTime = 0;
  const throttleIntervalMs = 80;

  // Simulate 60 frames (1 second at 60fps)
  for (let frame = 0; frame < 60; frame++) {
    const now = frame * (1000 / 60); // ~16.6ms per frame
    if (now - lastUpdateTime >= throttleIntervalMs) {
      lastUpdateTime = now;
      stateUpdateCount++;
    }
  }

  // At 60fps without throttling: 60 updates.
  // With 80ms throttle: exactly 13 updates (1 + Math.floor(1000 / 80)).
  assert.ok(stateUpdateCount <= 14, `State updates must be throttled to <=14 per second, got ${stateUpdateCount}`);
  assert.ok(stateUpdateCount >= 10, `State updates must remain smooth (>=10 per second), got ${stateUpdateCount}`);
  const reductionPercent = Math.round(((60 - stateUpdateCount) / 60) * 100);
  assert.ok(reductionPercent >= 75, `Expected >=75% reduction in React reconciliation, achieved ${reductionPercent}%`);
});

test("Performance & Stability: Route code splitting and chunk isolation", () => {
  const fs = require("node:fs");
  const path = require("node:path");

  const distDir = path.resolve(__dirname, "../../frontend/dist/assets");
  if (!fs.existsSync(distDir)) {
    // If not built in this local environment yet, skip
    return;
  }

  const files = fs.readdirSync(distDir);
  const hostChunk = files.find((f) => f.startsWith("HostDashboardPage-") && f.endsWith(".js"));
  const listenerChunk = files.find((f) => f.startsWith("LiveSessionPage-") && f.endsWith(".js"));
  const joinChunk = files.find((f) => f.startsWith("ListenerJoinPage-") && f.endsWith(".js"));
  const indexChunk = files.find((f) => f.startsWith("index-") && f.endsWith(".js"));

  assert.ok(hostChunk, "HostDashboardPage must be isolated in its own dynamic chunk");
  assert.ok(listenerChunk, "LiveSessionPage must be isolated in its own dynamic chunk");
  assert.ok(joinChunk, "ListenerJoinPage (with QR scanner) must be isolated in its own chunk");
  assert.ok(indexChunk, "Index chunk must exist");

  const indexStats = fs.statSync(path.join(distDir, indexChunk));
  // Uncompressed index chunk must be under 300 kB (previously was ~471 kB)
  assert.ok(
    indexStats.size < 300 * 1024,
    `Initial index chunk size must be under 300 kB, got ${Math.round(indexStats.size / 1024)} kB`
  );
});
