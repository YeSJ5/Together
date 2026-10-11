const assert = require("node:assert");
const test = require("node:test");
const crypto = require("node:crypto");
const { getIceServerConfig, DEFAULT_STUN_SERVERS } = require("../src/iceConfig");

test("Network Traversal: Dynamic TURN credential generation via RFC 5766 HMAC-SHA1", () => {
  const originalEnv = { ...process.env };

  try {
    process.env.TURN_URLS = "turn:turn.together-audio.live:3478?transport=udp,turns:turn.together-audio.live:5349?transport=tcp";
    process.env.TURN_SECRET = "super-secret-turn-hmac-key-2026";

    const clientId = "beta-listener-42";
    const config = getIceServerConfig({ clientId, ttlSeconds: 3600 });

    assert.strictEqual(config.hasTurn, true);
    assert.strictEqual(config.ttl, 3600);
    assert.ok(Array.isArray(config.iceServers));

    // Find the TURN entry
    const turnEntry = config.iceServers.find((s) =>
      Array.isArray(s.urls) && s.urls.some((u) => u.startsWith("turn:") || u.startsWith("turns:"))
    );

    assert.ok(turnEntry, "Must include TURN server configuration");
    assert.ok(turnEntry.username, "Must generate ephemeral username");
    assert.ok(turnEntry.credential, "Must generate HMAC credential");

    // Verify secret is NOT exposed
    assert.strictEqual(
      JSON.stringify(config).includes("super-secret-turn-hmac-key-2026"),
      false,
      "TURN secret must NEVER be leaked in configuration output"
    );

    // Verify username structure: {expiry}:{clientId}
    const [expiryStr, parsedClient] = turnEntry.username.split(":");
    const expiry = Number(expiryStr);
    const nowSec = Math.floor(Date.now() / 1000);

    assert.strictEqual(parsedClient, clientId);
    assert.ok(expiry >= nowSec + 3500 && expiry <= nowSec + 3700, "Expiry must match requested TTL window");

    // Independently verify HMAC-SHA1 signature
    const hmac = crypto.createHmac("sha1", "super-secret-turn-hmac-key-2026");
    hmac.update(turnEntry.username);
    const expectedCredential = hmac.digest("base64");

    assert.strictEqual(
      turnEntry.credential,
      expectedCredential,
      "TURN credential must match exact HMAC-SHA1 digest of username"
    );
  } finally {
    process.env = originalEnv;
  }
});

test("Network Traversal: High-availability STUN fallback when TURN is unconfigured", () => {
  const originalEnv = { ...process.env };
  delete process.env.TURN_URLS;
  delete process.env.TURN_SECRET;
  delete process.env.TURN_USERNAME;
  delete process.env.TURN_CREDENTIAL;

  try {
    const config = getIceServerConfig({ clientId: "client-fallback" });
    assert.strictEqual(config.hasTurn, false);
    assert.ok(config.iceServers.length >= 3, "Must provide redundant high-availability STUN servers");
    assert.ok(config.iceServers.some((s) => s.urls.includes("google.com")));
  } finally {
    process.env = originalEnv;
  }
});
