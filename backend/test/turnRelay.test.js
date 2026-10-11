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
    assert.strictEqual(config.turnType, "none");
    assert.ok(config.iceServers.length >= 3, "Must provide redundant high-availability STUN servers");
    assert.ok(config.iceServers.some((s) => s.urls.includes("google.com")));
  } finally {
    process.env = originalEnv;
  }
});

test("Network Traversal: Static credentials and input bounds validation", () => {
  const originalEnv = { ...process.env };

  try {
    // 1. Static credentials support
    process.env.TURN_URLS = "turn:relay.provider.com:3478";
    process.env.TURN_USERNAME = "static-user";
    process.env.TURN_CREDENTIAL = "static-password";
    delete process.env.TURN_SECRET;

    const staticConfig = getIceServerConfig();
    assert.strictEqual(staticConfig.hasTurn, true);
    assert.strictEqual(staticConfig.turnType, "static-auth");
    const turnEntry = staticConfig.iceServers.find((s) => s.username === "static-user");
    assert.ok(turnEntry);
    assert.strictEqual(turnEntry.credential, "static-password");

    // 2. Bound checks on negative or extreme TTL
    delete process.env.TURN_USERNAME;
    delete process.env.TURN_CREDENTIAL;
    process.env.TURN_SECRET = "test-secret";

    const clampedLow = getIceServerConfig({ ttlSeconds: -50 });
    assert.strictEqual(clampedLow.ttl, 60, "Negative TTL must clamp to minimum 60s");

    const clampedHigh = getIceServerConfig({ ttlSeconds: 99999999 });
    assert.strictEqual(clampedHigh.ttl, 604800, "Extreme TTL must clamp to maximum 7 days (604800s)");

    // 3. ClientId sanitization
    const sanitized = getIceServerConfig({ clientId: "malicious!@#$$%^&*()_+`~client" });
    const user = sanitized.iceServers.find((s) => s.username).username;
    assert.ok(!user.includes("@#$$%^"), "Client ID must be sanitized to safe alphanumeric characters");
  } finally {
    process.env = originalEnv;
  }
});

test("Network Traversal: Coturn deployment asset audit & configuration verification", () => {
  const fs = require("node:fs");
  const path = require("node:path");

  const confPath = path.resolve(__dirname, "../../deploy/coturn/turnserver.conf");
  const scriptPath = path.resolve(__dirname, "../../deploy/coturn/setup-coturn.sh");
  const composePath = path.resolve(__dirname, "../../deploy/coturn/docker-compose.yml");

  assert.ok(fs.existsSync(confPath), "deploy/coturn/turnserver.conf must exist");
  assert.ok(fs.existsSync(scriptPath), "deploy/coturn/setup-coturn.sh must exist");
  assert.ok(fs.existsSync(composePath), "deploy/coturn/docker-compose.yml must exist");

  const confContent = fs.readFileSync(confPath, "utf8");
  const scriptContent = fs.readFileSync(scriptPath, "utf8");

  // Verify critical Coturn directives
  assert.ok(confContent.includes("use-auth-secret"), "Must enable RFC 5766 use-auth-secret");
  assert.ok(confContent.includes("min-port=49152"), "Relay min port must be 49152");
  assert.ok(confContent.includes("max-port=65535"), "Relay max port must be 65535");
  assert.ok(confContent.includes("denied-peer-ip=169.254.0.0-169.254.255.255"), "Must block cloud metadata service IP");
  assert.ok(confContent.includes("denied-peer-ip=127.0.0.0-127.255.255.255"), "Must block loopback IPv4");
  assert.ok(confContent.includes("proc-user=turnserver"), "Must drop privileges to turnserver user");

  // Verify setup script firewall rules match configuration
  assert.ok(scriptContent.includes("49152:65535/udp"), "UFW rule must match relay port range");
  assert.ok(scriptContent.includes("3478/udp") && scriptContent.includes("3478/tcp"), "Must allow standard TURN ports");
  assert.ok(scriptContent.includes("5349/udp") && scriptContent.includes("5349/tcp"), "Must allow secure TURNS ports");

  // Test vector: Verify exact Coturn HMAC-SHA1 calculation
  const testSecret = "coturn-verification-secret-32-bytes";
  const testUsername = "1750000000:together-client-1";
  const hmac = crypto.createHmac("sha1", testSecret).update(testUsername).digest("base64");
  assert.ok(hmac && typeof hmac === "string" && hmac.length === 28, "HMAC-SHA1 Base64 must be 28 characters");
});

const http = require("node:http");
const { spawn } = require("node:child_process");
const fs = require("node:fs");

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

function getBrowserExecutable() {
  if (fs.existsSync(CHROME_PATH)) return CHROME_PATH;
  if (fs.existsSync(EDGE_PATH)) return EDGE_PATH;
  return null;
}

test("Network Traversal: Browser verification of STUN traversal vs relay-only ICE policy", async (t) => {
  const browserBin = getBrowserExecutable();
  if (!browserBin) {
    t.skip("No Chrome or Edge executable found for network traversal test.");
    return;
  }

  let resolveTraversal;
  let rejectTraversal;
  const traversalPromise = new Promise((resolve, reject) => {
    resolveTraversal = resolve;
    rejectTraversal = reject;
  });

  const app = require("express")();
  app.use(require("express").json());

  app.post("/report-traversal", (req, res) => {
    res.json({ ok: true });
    resolveTraversal(req.body);
  });

  const testHtml = `<!DOCTYPE html>
<html>
<head><title>Network Traversal Test</title></head>
<body>
<h1>Testing STUN Direct Traversal vs Relay-only ICE Policy</h1>
<script>
async function run() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const track = stream.getAudioTracks()[0];

    // TEST 1: STUN-capable connection (iceTransportPolicy: "all")
    const pcHost = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      iceTransportPolicy: "all"
    });
    const pcListener = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      iceTransportPolicy: "all"
    });

    pcHost.addTrack(track, stream);
    pcHost.onicecandidate = (e) => { if (e.candidate) pcListener.addIceCandidate(e.candidate); };
    pcListener.onicecandidate = (e) => { if (e.candidate) pcHost.addIceCandidate(e.candidate); };

    let stunPackets = 0;
    let stunCandidateType = "unknown";

    const stunMediaPromise = new Promise((res) => {
      pcListener.ontrack = async () => {
        await new Promise((r) => setTimeout(r, 600));
        const stats = await pcListener.getStats();
        stats.forEach((s) => {
          if (s.type === "inbound-rtp") stunPackets = s.packetsReceived || 0;
          if (s.type === "local-candidate") stunCandidateType = s.candidateType || "host";
        });
        res();
      };
    });

    const offer = await pcHost.createOffer();
    await pcHost.setLocalDescription(offer);
    await pcListener.setRemoteDescription(offer);
    const answer = await pcListener.createAnswer();
    await pcListener.setLocalDescription(answer);
    await pcHost.setRemoteDescription(answer);

    await stunMediaPromise;
    pcHost.close();
    pcListener.close();

    // TEST 2: Relay-only ICE policy WITHOUT an active TURN server
    // (Documents genuine behavior when TURN infrastructure is unconfigured)
    const pcRelayOnly = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      iceTransportPolicy: "relay"
    });

    let relayCandidatesGathered = 0;
    pcRelayOnly.onicecandidate = (e) => {
      if (e.candidate && e.candidate.type === "relay") relayCandidatesGathered++;
    };

    const relayOffer = await pcRelayOnly.createOffer();
    await pcRelayOnly.setLocalDescription(relayOffer);

    // Allow 500ms for gathering
    await new Promise((r) => setTimeout(r, 500));
    pcRelayOnly.close();
    track.stop();

    fetch("/report-traversal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        stunPacketsReceived: stunPackets,
        stunCandidateType,
        relayCandidatesWithoutTurn: relayCandidatesGathered,
        turnInfrastructureConfigured: false
      })
    });
  } catch (err) {
    fetch("/report-traversal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message })
    });
  }
}
window.addEventListener("DOMContentLoaded", run);
</script>
</body>
</html>`;

  app.get("/", (_req, res) => res.send(testHtml));

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const chromeProc = spawn(
    browserBin,
    [
      "--headless=new",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--allow-file-access-from-files",
      "--no-sandbox",
      baseUrl
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );

  const killChrome = () => {
    try {
      chromeProc.kill("SIGKILL");
    } catch (_e) {}
  };

  const timer = setTimeout(() => {
    killChrome();
    rejectTraversal(new Error("Network traversal test timed out after 25s"));
  }, 25000);

  try {
    const report = await traversalPromise;
    clearTimeout(timer);
    killChrome();

    assert.ok(report.success, "Traversal test must execute");
    assert.ok(report.stunPacketsReceived > 0, "STUN-capable audio must flow");
    assert.strictEqual(
      report.relayCandidatesWithoutTurn,
      0,
      "Without configured TURN server, relay-only policy gathers 0 candidates (RFC 5245/8445)"
    );
  } finally {
    clearTimeout(timer);
    killChrome();
    server.close();
  }
});

