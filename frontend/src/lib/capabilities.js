/**
 * TOGETHER Capability & Environment Detection
 * 
 * Replaces hardcoded browser name allowlists with feature-based capability checks.
 * Distinguishes Host media-capture requirements from Listener audio-reception requirements.
 */

export function isSecureContext() {
  if (typeof window === "undefined") return true;
  // Localhost and 127.0.0.1 are treated as secure by browsers even over http
  if (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "[::1]"
  ) {
    return true;
  }
  return Boolean(window.isSecureContext || window.location.protocol === "https:");
}

export function supportsWebRTC() {
  if (typeof window === "undefined") return false;
  return (
    typeof window.RTCPeerConnection === "function" &&
    typeof window.RTCSessionDescription === "function" &&
    typeof window.RTCIceCandidate === "function"
  );
}

export function supportsAudioPlayback() {
  if (typeof window === "undefined") return false;
  return (
    typeof window.Audio === "function" ||
    typeof window.AudioContext === "function" ||
    typeof window.webkitAudioContext === "function"
  );
}

export function supportsDisplayMedia() {
  if (typeof navigator === "undefined") return false;
  return Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === "function");
}

export function supportsUserMedia() {
  if (typeof navigator === "undefined") return false;
  return Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function");
}

/**
 * Detects if the current page is running inside an embedded WebView or in-app browser
 * (e.g., Google App GSA, Instagram, Facebook, TikTok, Twitter/X, WeChat, or Android WebView).
 */
export function isInAppBrowser() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  
  // Google Search App (Android & iOS)
  if (/\bGSA\b/i.test(ua)) return true;
  
  // Android WebViews (typically contain ; wv) or Version/X.X Chrome/...
  if (/\bwv\b/i.test(ua) || (/Version\/[0-9.]+/i.test(ua) && /Chrome\//i.test(ua))) {
    return true;
  }
  
  // Common social / in-app browsers
  if (/FBAN|FBAV|Instagram|Line\/|Twitter|Snapchat|ByteLocale|TikTok|MicroMessenger/i.test(ua)) {
    return true;
  }
  
  return false;
}

export function getInAppBrowserName() {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent || "";
  if (/\bGSA\b/i.test(ua)) return "Google App";
  if (/Instagram/i.test(ua)) return "Instagram";
  if (/FBAN|FBAV/i.test(ua)) return "Facebook";
  if (/Twitter/i.test(ua)) return "X (Twitter)";
  if (/TikTok|ByteLocale/i.test(ua)) return "TikTok";
  if (/Snapchat/i.test(ua)) return "Snapchat";
  if (/\bwv\b/i.test(ua) || (/Version\/[0-9.]+/i.test(ua) && /Chrome\//i.test(ua))) return "In-App Browser";
  return null;
}

/**
 * Builds an Android intent URL to open the target destination in Chrome,
 * or returns standard URL for iOS/desktop.
 */
export function getExternalBrowserUrl(rawUrl) {
  if (typeof window === "undefined") return rawUrl || "";
  const target = rawUrl || window.location.href;
  try {
    const parsed = new URL(target, window.location.href);
    const ua = navigator.userAgent || "";
    if (/Android/i.test(ua)) {
      // Android Intent scheme to launch external Google Chrome
      const scheme = parsed.protocol.replace(":", "");
      const hostAndPath = parsed.host + parsed.pathname + parsed.search;
      const hash = parsed.hash ? parsed.hash : "";
      return `intent://${hostAndPath}${hash}#Intent;scheme=${scheme};package=com.android.chrome;end`;
    }
  } catch (_e) {}
  return target;
}

/**
 * Evaluates listener capability requirements:
 * Listeners require:
 * 1. Secure context (or localhost)
 * 2. WebRTC (RTCPeerConnection)
 * 3. Audio playback capability
 * Note: Listeners DO NOT need screen capture (getDisplayMedia) or microphone permissions.
 */
export function getListenerCapabilities() {
  const secure = isSecureContext();
  const webrtc = supportsWebRTC();
  const audio = supportsAudioPlayback();
  const inApp = isInAppBrowser();
  const inAppName = getInAppBrowserName();

  const missing = [];
  if (!secure) missing.push("Secure Context (HTTPS)");
  if (!webrtc) missing.push("WebRTC (RTCPeerConnection)");
  if (!audio) missing.push("HTML5 Audio / AudioContext");

  return {
    isCompatible: secure && webrtc && audio,
    isSecure: secure,
    hasWebRTC: webrtc,
    hasAudio: audio,
    isInApp: inApp,
    inAppName,
    missingCapabilities: missing
  };
}

/**
 * Evaluates host capability requirements:
 * Host requires:
 * 1. Secure context
 * 2. WebRTC
 * 3. Channel 1 (Mic): getUserMedia
 * 4. Channel 2 (Tab/Screen Audio): getDisplayMedia with audio
 * 5. Channel 3 (File deck): AudioContext / HTML5 audio
 */
export function getHostCapabilities() {
  const secure = isSecureContext();
  const webrtc = supportsWebRTC();
  const mic = supportsUserMedia();
  const displayMedia = supportsDisplayMedia();
  const audio = supportsAudioPlayback();

  return {
    isSecure: secure,
    hasWebRTC: webrtc,
    canHostMic: secure && webrtc && mic,
    canHostTabAudio: secure && webrtc && displayMedia,
    canHostAudioFiles: secure && webrtc && audio,
    isTabAudioSupported: displayMedia
  };
}
