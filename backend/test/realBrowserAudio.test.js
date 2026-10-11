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

test("Real Browser WebRTC Audio Flow: Peer-to-peer audio transmission in Chromium", async (t) => {
  const browserBin = getBrowserExecutable();
  if (!browserBin) {
    t.skip("No Chrome or Edge executable found on this host for browser media verification.");
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
<head><title>WebRTC Audio Test</title></head>
<body>
<h1>Testing real browser WebRTC audio</h1>
<script>
async function run() {
  try {
    // 1. Capture synthetic media stream from browser's fake device
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) throw new Error("No audio track captured");

    // 2. Setup Host PeerConnection
    const pcHost = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
    pcHost.addTrack(audioTrack, stream);

    // 3. Setup Listener PeerConnection
    const pcListener = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    let remoteAudioReceived = false;
    let maxRms = 0;

    pcListener.ontrack = async (event) => {
      remoteAudioReceived = true;
      const remoteStream = event.streams[0];

      // Route stream to audio element so Chrome WebRTC pipeline starts rendering RTP packets
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

      // Poll analyser for incoming audio energy across 1.5 seconds
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 100));
        analyser.getByteFrequencyData(buffer);
        let sum = 0;
        for (let j = 0; j < buffer.length; j++) sum += buffer[j];
        const avg = sum / buffer.length;
        if (avg > maxRms) maxRms = avg;
      }

      // Collect candidate pair stats
      let candidateType = "direct";
      try {
        const stats = await pcListener.getStats();
        stats.forEach(report => {
          if (report.type === "candidate-pair" && report.state === "succeeded") {
            const local = stats.get(report.localCandidateId);
            if (local && local.candidateType) candidateType = local.candidateType;
          }
        });
      } catch (e) {}

      // Report success back to Node test runner
      fetch('/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          remoteAudioReceived,
          audioEnergy: maxRms,
          trackKind: audioTrack.kind,
          candidateType
        })
      });
    };

    // ICE exchange
    pcHost.onicecandidate = (e) => { if (e.candidate) pcListener.addIceCandidate(e.candidate); };
    pcListener.onicecandidate = (e) => { if (e.candidate) pcHost.addIceCandidate(e.candidate); };

    // Offer / Answer negotiation
    const offer = await pcHost.createOffer();
    await pcHost.setLocalDescription(offer);
    await pcListener.setRemoteDescription(offer);

    const answer = await pcListener.createAnswer();
    await pcListener.setLocalDescription(answer);
    await pcHost.setRemoteDescription(answer);

  } catch (err) {
    fetch('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: err.message })
    });
  }
}
window.onload = run;
</script>
</body>
</html>`;

  const server = http.createServer((req, res) => {
    if (req.url === "/verify" && req.method === "POST") {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", () => {
        try {
          const result = JSON.parse(body);
          resolveVerification(result);
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

  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const testUrl = `http://127.0.0.1:${port}/`;

  // Launch real headless Chromium with fake synthetic audio device
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
      rejectVerification(new Error("Timeout (10s) waiting for browser WebRTC audio verification"));
    }, 10000);

    const result = await verificationPromise;
    clearTimeout(timeoutTimer);

    assert.strictEqual(result.success, true, `Browser audio test failed: ${result.error}`);
    assert.strictEqual(result.remoteAudioReceived, true, "Remote peer connection must receive audio track");
    assert.strictEqual(result.trackKind, "audio", "Track kind must be audio");
    assert.ok(result.audioEnergy > 0, `Audio energy must be detected (got: ${result.audioEnergy})`);
  } finally {
    browserProc.kill();
    server.close();
  }
});
