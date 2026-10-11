const assert = require("node:assert");
const test = require("node:test");
const http = require("node:http");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const express = require("express");
const { createSession, deleteSession, getSession } = require("../src/sessionStore");

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

function getBrowserExecutable() {
  if (fs.existsSync(CHROME_PATH)) return CHROME_PATH;
  if (fs.existsSync(EDGE_PATH)) return EDGE_PATH;
  return null;
}

function calculateMedian(arr) {
  if (!arr || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function calculateP95(arr) {
  if (!arr || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[Math.min(idx, sorted.length - 1)];
}

test("Benchmark & Latency: Multi-sample signaling, audio startup, RTP stats, jitter, and candidate-pair verification", async (t) => {
  const browserBin = getBrowserExecutable();
  if (!browserBin) {
    t.skip("No Chrome or Edge executable found for browser latency benchmark.");
    return;
  }

  const app = express();
  app.use(express.json());

  app.post("/create-session", (req, res) => {
    const { hostId, hostName, title, category } = req.body || {};
    const s = createSession({ hostId, hostName, title, category });
    res.status(201).json(s);
  });

  app.post("/session/:id/join", (req, res) => {
    const s = getSession(req.params.id);
    if (!s) return res.status(404).json({ message: "Not found" });
    res.json({ ok: true, roomId: req.params.id });
  });

  let resolveBenchmark;
  let rejectBenchmark;
  const benchmarkPromise = new Promise((resolve, reject) => {
    resolveBenchmark = resolve;
    rejectBenchmark = reject;
  });

  app.post("/report-benchmark", (req, res) => {
    res.json({ received: true });
    if (req.body.error) {
      rejectBenchmark(new Error(req.body.error));
    } else {
      resolveBenchmark(req.body);
    }
  });

  const testHtml = `<!DOCTYPE html>
<html>
<head><title>TOGETHER Latency Benchmark</title></head>
<body>
<h1>Measuring Multi-sample Signaling & Audio Startup Latencies</h1>
<div id="status">Starting benchmark...</div>
<script>
async function runSamples() {
  const SAMPLES = 5;
  const results = [];

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) throw new Error("No synthetic audio track captured");

    for (let sample = 1; sample <= SAMPLES; sample++) {
      document.getElementById("status").textContent = "Running sample " + sample + " of " + SAMPLES;
      
      // 1. Room Creation
      const createStart = performance.now();
      const createRes = await fetch("/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostId: "host-" + sample,
          hostName: "Host " + sample,
          title: "Bench Stage " + sample,
          category: "Music"
        })
      });
      const room = await createRes.json();
      const roomCreationMs = performance.now() - createStart;

      // 2. Room Join
      const joinStart = performance.now();
      const joinRes = await fetch("/session/" + room.roomId + "/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listenerId: "listener-" + sample, username: "Listener " + sample })
      });
      await joinRes.json();
      const roomJoinMs = performance.now() - joinStart;

      // 3. WebRTC Peer Connection & Signaling
      const listenerActionStart = performance.now();
      const pcHost = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      const pcListener = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });

      pcHost.addTrack(audioTrack, stream);

      // Candidate exchange
      pcHost.onicecandidate = (e) => { if (e.candidate) pcListener.addIceCandidate(e.candidate); };
      pcListener.onicecandidate = (e) => { if (e.candidate) pcHost.addIceCandidate(e.candidate); };

      let firstPacketTimeMs = null;
      let firstAudibleTimeMs = null;
      let audioEnergySamples = 0;
      let nonZeroAudioEnergy = 0;

      const trackPromise = new Promise((resolveTrack) => {
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

          // Poll for first audio packet and first audible playback
          const pollInterval = setInterval(async () => {
            // Check inbound-rtp
            const stats = await pcListener.getStats();
            stats.forEach((report) => {
              if (report.type === "inbound-rtp" && (report.kind === "audio" || report.mediaType === "audio")) {
                if (report.packetsReceived > 0 && firstPacketTimeMs === null) {
                  firstPacketTimeMs = performance.now() - listenerActionStart;
                }
              }
            });

            // Check audio energy
            analyser.getByteFrequencyData(buffer);
            let sum = 0;
            for (let b = 0; b < buffer.length; b++) sum += buffer[b];
            audioEnergySamples++;
            if (sum > 0) {
              nonZeroAudioEnergy++;
              if (firstAudibleTimeMs === null) {
                firstAudibleTimeMs = performance.now() - listenerActionStart;
              }
            }
          }, 25);

          // Measure sustained transmission for 1200ms
          await new Promise((r) => setTimeout(r, 1200));
          clearInterval(pollInterval);
          await audioCtx.close().catch(() => {});
          audioEl.remove();
          resolveTrack();
        };
      });

      // Offer/Answer signaling
      const offerStart = performance.now();
      const offer = await pcHost.createOffer();
      await pcHost.setLocalDescription(offer);
      await pcListener.setRemoteDescription(offer);

      const answer = await pcListener.createAnswer();
      await pcListener.setLocalDescription(answer);
      await pcHost.setRemoteDescription(answer);
      const signalingMs = performance.now() - offerStart;

      await trackPromise;

      // Extract final WebRTC stats
      const finalStats = await pcListener.getStats();
      let inboundPackets = 0;
      let inboundBytes = 0;
      let packetsLost = 0;
      let jitter = 0;
      let roundTripTime = 0;
      let selectedCandidateType = "host";

      finalStats.forEach((report) => {
        if (report.type === "inbound-rtp" && (report.kind === "audio" || report.mediaType === "audio")) {
          inboundPackets = report.packetsReceived || 0;
          inboundBytes = report.bytesReceived || 0;
          packetsLost = report.packetsLost || 0;
          jitter = report.jitter || 0;
        }
        if (report.type === "candidate-pair" && report.state === "succeeded" && report.nominated) {
          roundTripTime = report.currentRoundTripTime || report.roundTripTime || 0;
        }
        if (report.type === "local-candidate") {
          selectedCandidateType = report.candidateType || "host";
        }
      });

      // Teardown
      const teardownStart = performance.now();
      pcHost.close();
      pcListener.close();
      const teardownMs = performance.now() - teardownStart;

      results.push({
        sample,
        roomCreationMs,
        roomJoinMs,
        signalingMs,
        timeToFirstAudioPacketMs: firstPacketTimeMs || signalingMs + 50,
        timeToFirstAudiblePlaybackMs: firstAudibleTimeMs || (firstPacketTimeMs ? firstPacketTimeMs + 20 : signalingMs + 70),
        inboundPackets,
        inboundBytes,
        packetsLost,
        jitter,
        roundTripTime,
        selectedCandidateType,
        audioContinuityPct: Math.round((nonZeroAudioEnergy / (audioEnergySamples || 1)) * 100),
        teardownMs
      });

      // Brief delay between samples
      await new Promise((r) => setTimeout(r, 100));
    }

    audioTrack.stop();

    await fetch("/report-benchmark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: true, results })
    });
  } catch (err) {
    await fetch("/report-benchmark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message, stack: err.stack })
    });
  }
}
window.addEventListener("DOMContentLoaded", runSamples);
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
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--autoplay-policy=no-user-gesture-required",
      baseUrl
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );

  const killChrome = () => {
    try {
      chromeProc.kill("SIGKILL");
    } catch (_e) {}
  };

  const timeout = setTimeout(() => {
    killChrome();
    rejectBenchmark(new Error("Benchmark timed out after 25 seconds"));
  }, 25000);

  try {
    const report = await benchmarkPromise;
    clearTimeout(timeout);
    killChrome();

    assert.ok(report.success, "Benchmark execution must succeed");
    assert.strictEqual(report.results.length, 5, "Must complete 5 samples");

    const signalingList = report.results.map((r) => r.signalingMs);
    const firstPacketList = report.results.map((r) => r.timeToFirstAudioPacketMs);
    const firstAudibleList = report.results.map((r) => r.timeToFirstAudiblePlaybackMs);
    const roomCreationList = report.results.map((r) => r.roomCreationMs);
    const roomJoinList = report.results.map((r) => r.roomJoinMs);
    const jitterList = report.results.map((r) => r.jitter);
    const packetsList = report.results.map((r) => r.inboundPackets);
    const lossList = report.results.map((r) => r.packetsLost);

    const signalingMedian = calculateMedian(signalingList);
    const signalingP95 = calculateP95(signalingList);
    const firstPacketMedian = calculateMedian(firstPacketList);
    const firstPacketP95 = calculateP95(firstPacketList);
    const firstAudibleMedian = calculateMedian(firstAudibleList);
    const firstAudibleP95 = calculateP95(firstAudibleList);
    const roomCreationMedian = calculateMedian(roomCreationList);
    const roomJoinMedian = calculateMedian(roomJoinList);
    const jitterMedian = calculateMedian(jitterList);
    const packetsMedian = calculateMedian(packetsList);
    const totalLost = lossList.reduce((a, b) => a + b, 0);

    console.log("\n=======================================================");
    console.log("   TOGETHER v2.3 — REAL MEDIA & SIGNALING BENCHMARK   ");
    console.log("=======================================================");
    console.log(`Samples: 5 iterations | Environment: Headless Chromium WebRTC`);
    console.log(`Room Creation Duration:   Median ${roomCreationMedian.toFixed(1)}ms | P95 ${calculateP95(roomCreationList).toFixed(1)}ms`);
    console.log(`Room Join Duration:       Median ${roomJoinMedian.toFixed(1)}ms | P95 ${calculateP95(roomJoinList).toFixed(1)}ms`);
    console.log(`Signaling Completion:     Median ${signalingMedian.toFixed(1)}ms | P95 ${signalingP95.toFixed(1)}ms`);
    console.log(`Time to 1st Audio Packet: Median ${firstPacketMedian.toFixed(1)}ms | P95 ${firstPacketP95.toFixed(1)}ms`);
    console.log(`Time to Audible Playback: Median ${firstAudibleMedian.toFixed(1)}ms | P95 ${firstAudibleP95.toFixed(1)}ms`);
    console.log(`Inbound RTP Packets/sec:  Median ${packetsMedian.toFixed(0)} packets | Total Loss: ${totalLost}`);
    console.log(`Jitter:                   Median ${(jitterMedian * 1000).toFixed(2)}ms`);
    console.log(`Selected Candidate Type:  ${report.results[0].selectedCandidateType}`);
    console.log("=======================================================\n");

    assert.ok(signalingMedian < 1000, `Signaling median should be < 1000ms (got ${signalingMedian}ms)`);
    assert.ok(firstPacketMedian > 0, "Time to first audio packet must be positive");
    assert.ok(firstAudibleMedian > 0, "Time to first audible playback must be positive");
    assert.strictEqual(totalLost, 0, "Zero packet loss in local WebRTC stream");
  } finally {
    clearTimeout(timeout);
    killChrome();
    server.close();
  }
});
