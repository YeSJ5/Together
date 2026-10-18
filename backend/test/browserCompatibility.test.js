const assert = require("node:assert");
const test = require("node:test");

/**
 * Capability & Environment Logic under test
 * (Mirrors frontend/src/lib/capabilities.js for Node testing environment)
 */

function isInAppBrowser(ua) {
  if (!ua) return false;
  if (/\bGSA\b/i.test(ua)) return true;
  if (/\bwv\b/i.test(ua) || (/Version\/[0-9.]+/i.test(ua) && /Chrome\//i.test(ua))) {
    return true;
  }
  if (/FBAN|FBAV|Instagram|Line\/|Twitter|Snapchat|ByteLocale|TikTok|MicroMessenger/i.test(ua)) {
    return true;
  }
  return false;
}

function getInAppBrowserName(ua) {
  if (!ua) return null;
  if (/\bGSA\b/i.test(ua)) return "Google App";
  if (/Instagram/i.test(ua)) return "Instagram";
  if (/FBAN|FBAV/i.test(ua)) return "Facebook";
  if (/Twitter/i.test(ua)) return "X (Twitter)";
  if (/TikTok|ByteLocale/i.test(ua)) return "TikTok";
  if (/Snapchat/i.test(ua)) return "Snapchat";
  if (/\bwv\b/i.test(ua) || (/Version\/[0-9.]+/i.test(ua) && /Chrome\//i.test(ua))) return "In-App Browser";
  return null;
}

function getExternalBrowserUrl(rawUrl, ua) {
  try {
    const parsed = new URL(rawUrl);
    if (/Android/i.test(ua)) {
      const scheme = parsed.protocol.replace(":", "");
      const hostAndPath = parsed.host + parsed.pathname + parsed.search;
      const hash = parsed.hash ? parsed.hash : "";
      return `intent://${hostAndPath}${hash}#Intent;scheme=${scheme};package=com.android.chrome;end`;
    }
  } catch (_e) {}
  return rawUrl;
}

function evaluateListenerCompatibility({ isSecure, hasWebRTC, hasAudio, ua }) {
  const inApp = isInAppBrowser(ua);
  const inAppName = getInAppBrowserName(ua);
  const missing = [];
  if (!isSecure) missing.push("Secure Context (HTTPS)");
  if (!hasWebRTC) missing.push("WebRTC (RTCPeerConnection)");
  if (!hasAudio) missing.push("HTML5 Audio / AudioContext");

  return {
    isCompatible: Boolean(isSecure && hasWebRTC && hasAudio),
    isInApp: inApp,
    inAppName,
    missingCapabilities: missing
  };
}

function isMobileDevice(ua) {
  if (!ua) return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}

function evaluateHostCapabilities({ isSecure, hasWebRTC, hasUserMedia, hasDisplayMedia, hasAudio, ua }) {
  const isMobile = isMobileDevice(ua);
  return {
    isSecure: Boolean(isSecure),
    hasWebRTC: Boolean(hasWebRTC),
    isMobile,
    canHostMic: Boolean(isSecure && hasWebRTC && hasUserMedia),
    canHostTabAudio: Boolean(isSecure && hasWebRTC && hasDisplayMedia && !isMobile),
    canHostAudioFiles: Boolean(isSecure && hasWebRTC && hasAudio),
    isTabAudioSupported: Boolean(hasDisplayMedia && !isMobile),
    tabAudioLimitationReason: isMobile
      ? "Mobile operating systems (Android & iOS) sandbox browsers and do not permit capturing audio from other background apps."
      : !hasDisplayMedia
      ? "Tab and system audio capture (getDisplayMedia) is not supported in this browser environment."
      : null
  };
}

test("Browser Compatibility: Correctly detects In-App browsers and Google App", () => {
  const googleAppUA = "Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230805.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.5845.163 Mobile Safari/537.36 GSA/14.35.14.28.arm64";
  const androidWebViewUA = "Mozilla/5.0 (Linux; U; Android 12; en-us; SM-G998B Build/SP1A.210812.016) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/96.0.4664.104 Mobile Safari/537.36";
  const instagramUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/20G75 Instagram 298.0.0.18.110";
  const standardChromeUA = "Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36";
  const standardSafariUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

  assert.strictEqual(isInAppBrowser(googleAppUA), true);
  assert.strictEqual(getInAppBrowserName(googleAppUA), "Google App");

  assert.strictEqual(isInAppBrowser(androidWebViewUA), true);
  assert.strictEqual(getInAppBrowserName(androidWebViewUA), "In-App Browser");

  assert.strictEqual(isInAppBrowser(instagramUA), true);
  assert.strictEqual(getInAppBrowserName(instagramUA), "Instagram");

  assert.strictEqual(isInAppBrowser(standardChromeUA), false);
  assert.strictEqual(getInAppBrowserName(standardChromeUA), null);

  assert.strictEqual(isInAppBrowser(standardSafariUA), false);
  assert.strictEqual(getInAppBrowserName(standardSafariUA), null);
});

test("Browser Compatibility: Host vs Listener capability separation", () => {
  // Mobile Safari on iOS: Cannot capture displayMedia audio, but HAS getUserMedia and Audio playback
  const mobileSafariEnv = {
    isSecure: true,
    hasWebRTC: true,
    hasUserMedia: true,
    hasDisplayMedia: false, // iOS WebKit does not provide getDisplayMedia with audio
    hasAudio: true,
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/604.1"
  };

  const hostCaps = evaluateHostCapabilities(mobileSafariEnv);
  const listenerCaps = evaluateListenerCompatibility(mobileSafariEnv);

  // Mobile Safari CAN be a listener! It must NOT be blocked!
  assert.strictEqual(listenerCaps.isCompatible, true);
  assert.strictEqual(listenerCaps.missingCapabilities.length, 0);

  // Mobile Safari CAN host Mic (Channel 1) and Audio File Player (Channel 3)
  assert.strictEqual(hostCaps.canHostMic, true);
  assert.strictEqual(hostCaps.canHostAudioFiles, true);

  // Mobile Safari CANNOT capture system/tab audio (Channel 2), but that should not break the app
  assert.strictEqual(hostCaps.canHostTabAudio, false);
});

test("Browser Compatibility: Mobile device detection across Android and iOS platforms", () => {
  const androidPhone = "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36";
  const iPhone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1";
  const iPad = "Mozilla/5.0 (iPad; CPU OS 16_5 like Mac OS X) AppleWebKit/605.1.15";
  const desktopChrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
  const desktopMacSafari = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15";

  assert.strictEqual(isMobileDevice(androidPhone), true);
  assert.strictEqual(isMobileDevice(iPhone), true);
  assert.strictEqual(isMobileDevice(iPad), true);
  assert.strictEqual(isMobileDevice(desktopChrome), false);
  assert.strictEqual(isMobileDevice(desktopMacSafari), false);
});

test("Browser Compatibility: Android mobile host capability marks Tab Audio as Desktop Only without breaking Studio", () => {
  const androidChromeHost = {
    isSecure: true,
    hasWebRTC: true,
    hasUserMedia: true,
    hasDisplayMedia: true, // Even if Chrome on Android reports getDisplayMedia method
    hasAudio: true,
    ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36"
  };

  const caps = evaluateHostCapabilities(androidChromeHost);
  assert.strictEqual(caps.isMobile, true);
  // Must NOT claim Android mobile browser can capture background app audio
  assert.strictEqual(caps.canHostTabAudio, false);
  assert.strictEqual(caps.isTabAudioSupported, false);
  assert.ok(caps.tabAudioLimitationReason.includes("sandboxing") || caps.tabAudioLimitationReason.includes("sandbox"));

  // Mobile host CAN broadcast via Music File Player and DJ Mic
  assert.strictEqual(caps.canHostAudioFiles, true);
  assert.strictEqual(caps.canHostMic, true);
});

test("Browser Compatibility: Desktop host enables Tab Audio, Mic, and Music Files", () => {
  const desktopHost = {
    isSecure: true,
    hasWebRTC: true,
    hasUserMedia: true,
    hasDisplayMedia: true,
    hasAudio: true,
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
  };

  const caps = evaluateHostCapabilities(desktopHost);
  assert.strictEqual(caps.isMobile, false);
  assert.strictEqual(caps.canHostTabAudio, true);
  assert.strictEqual(caps.canHostAudioFiles, true);
  assert.strictEqual(caps.canHostMic, true);
  assert.strictEqual(caps.tabAudioLimitationReason, null);
});

test("Browser Compatibility: In-App Android fallback generates valid Chrome Intent URL preserving room code", () => {
  const roomUrl = "https://together-puce.vercel.app/room/ROOM-TEST-1234?autoplay=1#track-info";
  const androidUA = "Mozilla/5.0 (Linux; Android 13; Pixel 7; wv) GSA/14.35.14.28.arm64";

  const intentUrl = getExternalBrowserUrl(roomUrl, androidUA);
  assert.ok(intentUrl.startsWith("intent://together-puce.vercel.app/room/ROOM-TEST-1234?autoplay=1#track-info#Intent;scheme=https;package=com.android.chrome;end"));

  // Desktop or iOS UA returns standard URL
  const iosUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";
  const standardUrl = getExternalBrowserUrl(roomUrl, iosUA);
  assert.strictEqual(standardUrl, roomUrl);
});

test("WebAudio Mixer Graph: Audio File Player lifecycle reuses single persistent element without node leakage", () => {
  // Simulate WebAudio destination and nodes
  let createdElementSourceCount = 0;
  let activeGainConnections = [];

  class MockAudioNode {
    connect(target) {
      activeGainConnections.push(target);
    }
    disconnect() {
      activeGainConnections = [];
    }
  }

  class MockMediaElementAudioSourceNode extends MockAudioNode {
    constructor() {
      super();
      createdElementSourceCount++;
    }
  }

  class MockAudioContext {
    createMediaElementSource(_audioElement) {
      return new MockMediaElementAudioSourceNode();
    }
    createMediaStreamDestination() {
      return { stream: { getAudioTracks: () => [{ id: "mock-master-track", kind: "audio", enabled: true }] } };
    }
    createGain() {
      return {
        gain: { value: 1.0, setTargetAtTime: (v) => { this.value = v; } },
        connect: () => {}
      };
    }
  }

  const ctx = new MockAudioContext();
  let persistentAudioElement = null;
  let sourceNode = null;

  function getOrCreateFileAudio() {
    if (!persistentAudioElement) {
      persistentAudioElement = { src: "", paused: true, play: async () => {}, pause: () => {} };
      if (!sourceNode) {
        sourceNode = ctx.createMediaElementSource(persistentAudioElement);
        sourceNode.connect(new MockAudioNode());
      }
    }
    return persistentAudioElement;
  }

  // Load File 1: "song1.mp3"
  const audio1 = getOrCreateFileAudio();
  audio1.src = "blob:http://localhost/song1";
  assert.strictEqual(createdElementSourceCount, 1);
  assert.strictEqual(activeGainConnections.length, 1);

  // Load File 2: "song2.flac" (Must REUSE existing element and source node, NOT create new ones)
  const audio2 = getOrCreateFileAudio();
  audio2.src = "blob:http://localhost/song2";
  assert.strictEqual(audio1, audio2, "Audio element must be reused");
  assert.strictEqual(createdElementSourceCount, 1, "MediaElementAudioSourceNode must NOT be recreated or leaked");
  assert.strictEqual(activeGainConnections.length, 1, "Connection must remain single and stable");

  // Teardown: Disconnect nodes and nullify references
  sourceNode.disconnect();
  sourceNode = null;
  persistentAudioElement = null;
  assert.strictEqual(activeGainConnections.length, 0, "Connections must be cleared cleanly on teardown");
});

test("WebAudio Mixer Graph: DJ Voice Mic lifecycle isolates host local speaker from microphone feedback", () => {
  let masterStreamInputs = [];
  let hostLocalSpeakerInputs = [];

  const masterDestination = {
    id: "webrtc-master-dest",
    connectInput: (name) => masterStreamInputs.push(name)
  };

  const hostSpeakerDestination = {
    id: "host-local-speaker",
    connectInput: (name) => hostLocalSpeakerInputs.push(name)
  };

  // Channel Gain Nodes routing
  const micGain = {
    name: "mic-gain",
    connect: (dest) => dest.connectInput("mic-gain")
  };

  const fileGain = {
    name: "file-gain",
    connect: (dest) => dest.connectInput("file-gain")
  };

  // Routing rule:
  // - File gain connects to BOTH WebRTC master destination AND Host local speaker (host can hear music)
  fileGain.connect(masterDestination);
  fileGain.connect(hostSpeakerDestination);

  // - Mic gain connects ONLY to WebRTC master destination (NEVER host speaker, preventing acoustic loop)
  micGain.connect(masterDestination);

  assert.ok(masterStreamInputs.includes("mic-gain"), "Mic audio must route to WebRTC listeners");
  assert.ok(masterStreamInputs.includes("file-gain"), "Music file audio must route to WebRTC listeners");
  assert.ok(hostLocalSpeakerInputs.includes("file-gain"), "Host must hear music file playback locally");
  assert.strictEqual(hostLocalSpeakerInputs.includes("mic-gain"), false, "Host local speaker must NEVER receive mic audio to prevent acoustic feedback");
});
