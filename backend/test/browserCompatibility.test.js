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

function evaluateHostCapabilities({ isSecure, hasWebRTC, hasUserMedia, hasDisplayMedia, hasAudio }) {
  return {
    isSecure: Boolean(isSecure),
    hasWebRTC: Boolean(hasWebRTC),
    canHostMic: Boolean(isSecure && hasWebRTC && hasUserMedia),
    canHostTabAudio: Boolean(isSecure && hasWebRTC && hasDisplayMedia),
    canHostAudioFiles: Boolean(isSecure && hasWebRTC && hasAudio),
    isTabAudioSupported: Boolean(hasDisplayMedia)
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
