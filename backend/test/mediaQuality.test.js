const assert = require("node:assert");
const test = require("node:test");
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

test("Media Quality Verification: Sustained audio transmission, RTP stats, jitter, and teardown", async (t) => {
  const browserBin = getBrowserExecutable();
  if (!browserBin) {
    t.skip("No Chrome or Edge executable found for media quality verification.");
    return;
  }

  let resolveVerification;
  let rejectVerification;
  const verificationPromise = new Promise((resolve, reject) => {
    resolveVerification = resolve;
    rejectVerification = reject;
  });

  const testHtml = `<!DOCTYPE html>
<html>
<head><title>WebRTC Media Quality Test</title></head>
<body>
<h1>Testing sustained audio transmission & RTP statistics</h1>
<script>
async function run() {
  try {
    const signalingStart = performance.now();

    // 1. Capture synthetic media
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) throw new Error("No audio track captured");

    // 2. Setup Host & Listener RTCPeerConnection
    const pcHost = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    pcHost.addTrack(audioTrack, stream);

    const pcListener = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });

    // ICE Exchange
    pcHost.onicecandidate = (e) => { if (e.candidate) pcListener.addIceCandidate(e.candidate); };
    pcListener.onicecandidate = (e) => { if (e.candidate) pcHost.addIceCandidate(e.candidate); };

    // 3. Attach ontrack before negotiation
    let receivedPackets = 0;
    let packetsLost = 0;
    let jitter = 0;
    let bytesReceived = 0;
    let samplesCount = 0;
    let maxAudioEnergy = 0;

    pcListener.ontrack = async (event) => {
      const remoteStream = event.streams[0];
      const audioEl = document.createElement("audio");
      audioEl.srcObject = remoteStream;
      audioEl.autoplay = true;
      document.body.appendChild(audioEl);
      await audioEl.play().catch(() => {});

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      await audioCtx.resume();
      const source = audioCtx.createMediaStreamSource(remoteStream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyser.connect(audioCtx.destination);

      const buffer = new Uint8Array(analyser.frequencyBinCount);

      // Measure sustained transmission over 1.5 seconds (15 samples x 100ms)
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 100));
        analyser.getByteFrequencyData(buffer);
        let sum = 0;
        for (let j = 0; j < buffer.length; j++) sum += buffer[j];
        const avg = sum / buffer.length;
        if (avg > maxAudioEnergy) maxAudioEnergy = avg;
        if (avg > 0) samplesCount++;
      }

      // Collect inbound-rtp statistics from RTCPeerConnection
      const stats = await pcListener.getStats();
      stats.forEach((report) => {
        if (report.type === "inbound-rtp" && (report.kind === "audio" || report.mediaType === "audio")) {
          receivedPackets = report.packetsReceived || 0;
          packetsLost = report.packetsLost || 0;
          jitter = report.jitter || 0;
          bytesReceived = report.bytesReceived || 0;
        }
      });

      // 4. Test Resource Cleanup / Teardown
      audioTrack.stop();
      pcHost.close();
      pcListener.close();
      await audioCtx.close().catch(() => {});

      const teardownClean = audioTrack.readyState === "ended" && pcListener.connectionState === "closed";

      fetch("/verify-quality", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          success: true,
          signalingDuration,
          receivedPackets,
          packetsLost,
          jitter,
          bytesReceived,
          samplesCount,
          maxAudioEnergy,
          teardownClean
        })
      });
    };

    // Offer / Answer
    const offer = await pcHost.createOffer();
    await pcHost.setLocalDescription(offer);
    await pcListener.setRemoteDescription(offer);

    const answer = await pcListener.createAnswer();
    await pcListener.setLocalDescription(answer);
    await pcHost.setRemoteDescription(answer);

    const signalingDuration = performance.now() - signalingStart;
  } catch (err) {
    fetch("/verify-quality", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: false, error: err.message })
    });
  }
}
window.onload = run;
</script>
</body>
</html>`;

  const server = http.createServer((req, res) => {
    if (req.url === "/verify-quality" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          resolveVerification(JSON.parse(body));
        } catch (e) {
          rejectVerification(e);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ received: true }));
      });
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(testHtml);
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const testUrl = `http://127.0.0.1:${port}/`;

  const browserProc = spawn(browserBin, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    testUrl
  ], { stdio: "ignore" });

  try {
    const timeoutTimer = setTimeout(() => {
      rejectVerification(new Error("Timeout (12s) waiting for media quality verification"));
    }, 12000);

    const result = await verificationPromise;
    clearTimeout(timeoutTimer);

    assert.strictEqual(result.success, true, `Media quality test failed: ${result.error}`);
    assert.ok(result.signalingDuration > 0, "Signaling handshake duration must be measurable");
    assert.ok(result.receivedPackets > 10, `Must receive sustained RTP audio packets (got: ${result.receivedPackets})`);
    assert.ok(result.bytesReceived > 500, `Must receive audio bytes (got: ${result.bytesReceived})`);
    assert.strictEqual(result.packetsLost, 0, "Local loopback packet loss must be 0");
    assert.ok(result.maxAudioEnergy > 0, "Audio energy must be detected during sustained playback");
    assert.ok(result.samplesCount >= 5, "Multiple consecutive audio frames must be active");
    assert.strictEqual(result.teardownClean, true, "Media tracks and peer connection must close cleanly");

    console.log(`[Media Quality] Signaling: ${result.signalingDuration.toFixed(1)}ms, RTP packets: ${result.receivedPackets}, bytes: ${result.bytesReceived}, packet loss: ${result.packetsLost}, jitter: ${result.jitter.toFixed(4)}s`);
  } finally {
    browserProc.kill();
    server.close();
  }
});
