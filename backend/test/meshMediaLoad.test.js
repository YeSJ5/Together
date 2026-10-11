const assert = require("node:assert");
const test = require("node:test");
const http = require("node:http");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const express = require("express");

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

function getBrowserExecutable() {
  if (fs.existsSync(CHROME_PATH)) return CHROME_PATH;
  if (fs.existsSync(EDGE_PATH)) return EDGE_PATH;
  return null;
}

test("Mesh Capacity & Media Load: Concurrent media delivery to 5 and 8 active listeners", async (t) => {
  const browserBin = getBrowserExecutable();
  if (!browserBin) {
    t.skip("No Chrome or Edge executable found for mesh media load test.");
    return;
  }

  const app = express();
  app.use(express.json());

  let resolveLoadTest;
  let rejectLoadTest;
  const loadTestPromise = new Promise((resolve, reject) => {
    resolveLoadTest = resolve;
    rejectLoadTest = reject;
  });

  app.post("/report-mesh-load", (req, res) => {
    res.json({ received: true });
    if (req.body.error) {
      rejectLoadTest(new Error(req.body.error));
    } else {
      resolveLoadTest(req.body);
    }
  });

  const testHtml = `<!DOCTYPE html>
<html>
<head><title>Mesh Media Delivery Load Test</title></head>
<body>
<h1>Testing Concurrent WebRTC Media Transmission Under Increasing Listener Load</h1>
<div id="status">Initializing host and listeners...</div>
<script>
async function runMeshLoadTest() {
  try {
    // 1. Capture host synthetic audio stream
    const hostStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const hostAudioTrack = hostStream.getAudioTracks()[0];
    if (!hostAudioTrack) throw new Error("Could not capture host audio track");

    // We will test progressively increasing tiers: 5 concurrent listeners, then 8 concurrent listeners
    const LISTENER_COUNTS = [5, 8];
    const tierResults = [];

    for (const listenerCount of LISTENER_COUNTS) {
      document.getElementById("status").textContent = "Testing " + listenerCount + " concurrent media listeners...";
      
      const hostPCs = [];
      const listenerPCs = [];
      const listenerStats = [];

      const startTime = performance.now();

      // Setup connections for all listeners in this tier
      for (let i = 0; i < listenerCount; i++) {
        const pcHost = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
        const pcListener = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });

        hostPCs.push(pcHost);
        listenerPCs.push(pcListener);

        // Host adds audio track for each listener in mesh topology
        pcHost.addTrack(hostAudioTrack, hostStream);

        // Cross-connect ICE candidates
        pcHost.onicecandidate = (e) => { if (e.candidate) pcListener.addIceCandidate(e.candidate); };
        pcListener.onicecandidate = (e) => { if (e.candidate) pcHost.addIceCandidate(e.candidate); };
      }

      // Track listeners that receive audio and detect energy
      const mediaPromises = listenerPCs.map((pcListener, idx) => {
        return new Promise((resolveListener) => {
          let hasReceivedPackets = false;
          let hasAudioEnergy = false;
          let firstPacketMs = 0;

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
            analyser.fftSize = 64;
            source.connect(analyser);
            analyser.connect(audioCtx.destination);

            const buffer = new Uint8Array(analyser.frequencyBinCount);

            let packetsReceived = 0;
            let bytesReceived = 0;
            let packetsLost = 0;
            let jitter = 0;

            // Poll for packets and energy over up to 2.5 seconds
            for (let p = 0; p < 25; p++) {
              await new Promise((r) => setTimeout(r, 100));
              const stats = await pcListener.getStats();
              stats.forEach((s) => {
                if (s.type === "inbound-rtp" && s.packetsReceived > 0) {
                  if (!hasReceivedPackets) {
                    hasReceivedPackets = true;
                    firstPacketMs = performance.now() - startTime;
                  }
                  packetsReceived = s.packetsReceived || 0;
                  bytesReceived = s.bytesReceived || 0;
                  packetsLost = s.packetsLost || 0;
                  jitter = s.jitter || 0;
                }
              });

              analyser.getByteFrequencyData(buffer);
              let sum = 0;
              for (let b = 0; b < buffer.length; b++) sum += buffer[b];
              if (sum > 0) hasAudioEnergy = true;

              if (packetsReceived >= 25 && p >= 12) break;
            }

            await audioCtx.close().catch(() => {});
            audioEl.remove();

            resolveListener({
              listenerIndex: idx + 1,
              hasReceivedPackets,
              hasAudioEnergy,
              firstPacketMs,
              packetsReceived,
              bytesReceived,
              packetsLost,
              jitter
            });
          };
        });
      });

      // Conduct negotiation for all peers concurrently
      await Promise.all(
        hostPCs.map(async (pcHost, i) => {
          const pcListener = listenerPCs[i];
          const offer = await pcHost.createOffer();
          await pcHost.setLocalDescription(offer);
          await pcListener.setRemoteDescription(offer);
          const answer = await pcListener.createAnswer();
          await pcListener.setLocalDescription(answer);
          await pcHost.setRemoteDescription(answer);
        })
      );

      const listenerResults = await Promise.all(mediaPromises);

      // Measure host outbound stats across all peer connections
      let totalHostPacketsSent = 0;
      let totalHostBytesSent = 0;
      for (const pcHost of hostPCs) {
        const stats = await pcHost.getStats();
        stats.forEach((s) => {
          if (s.type === "outbound-rtp") {
            totalHostPacketsSent += s.packetsSent || 0;
            totalHostBytesSent += s.bytesSent || 0;
          }
        });
      }

      // Teardown all PCs in this tier cleanly
      for (const pc of hostPCs) pc.close();
      for (const pc of listenerPCs) pc.close();

      const listenersReceivingAudio = listenerResults.filter((r) => r.hasReceivedPackets).length;
      const totalLoss = listenerResults.reduce((acc, r) => acc + r.packetsLost, 0);
      const avgJitter = listenerResults.reduce((acc, r) => acc + r.jitter, 0) / listenerResults.length;
      const avgStartupMs = listenerResults.reduce((acc, r) => acc + r.firstPacketMs, 0) / listenerResults.length;
      const hostBandwidthKbps = Math.round((totalHostBytesSent * 8) / 1.2 / 1000);

      tierResults.push({
        listenerCount,
        listenersReceivingAudio,
        totalHostPacketsSent,
        totalHostBytesSent,
        hostBandwidthKbps,
        totalLoss,
        avgJitter,
        avgStartupMs,
        listenerResults
      });
    }

    hostAudioTrack.stop();

    await fetch("/report-mesh-load", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: true, tierResults })
    });
  } catch (err) {
    await fetch("/report-mesh-load", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message, stack: err.stack })
    });
  }
}
window.addEventListener("DOMContentLoaded", runMeshLoadTest);
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

  const timer = setTimeout(() => {
    killChrome();
    rejectLoadTest(new Error("Mesh media load test timed out after 35s"));
  }, 35000);

  try {
    const report = await loadTestPromise;
    clearTimeout(timer);
    killChrome();

    assert.ok(report.success, "Mesh media load test must succeed");
    
    console.log("\n=======================================================");
    console.log("   TOGETHER v2.5 — WEBRTC MESH MEDIA DELIVERY LOAD    ");
    console.log("=======================================================");

    for (const tier of report.tierResults) {
      console.log(`[Tier: ${tier.listenerCount} Listeners]`);
      console.log(`  Connected Listeners:        ${tier.listenerCount}`);
      console.log(`  Successfully Streamed:      ${tier.listenersReceivingAudio} / ${tier.listenerCount} listeners (100%)`);
      console.log(`  Host Packets Sent:          ${tier.totalHostPacketsSent} pkts`);
      console.log(`  Host Upload Bandwidth:      ${tier.hostBandwidthKbps} kbps (~${(tier.hostBandwidthKbps / tier.listenerCount).toFixed(1)} kbps/peer)`);
      console.log(`  Total Packet Loss:          ${tier.totalLoss} packets`);
      console.log(`  Average Listener Jitter:    ${(tier.avgJitter * 1000).toFixed(2)} ms`);
      console.log(`  Avg Startup Latency:        ${tier.avgStartupMs.toFixed(1)} ms`);

      assert.strictEqual(
        tier.listenersReceivingAudio,
        tier.listenerCount,
        `All ${tier.listenerCount} connected listeners must successfully receive audio streams`
      );
      assert.strictEqual(tier.totalLoss, 0, `Packet loss across ${tier.listenerCount} mesh peers must be 0`);
      assert.ok(tier.totalHostPacketsSent > 50, `Host must transmit sustained packets to all ${tier.listenerCount} listeners`);
    }
    console.log("=======================================================\n");
  } finally {
    clearTimeout(timer);
    killChrome();
    server.close();
  }
});
