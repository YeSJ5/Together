import { LIVEKIT_URL } from "../config";
import { createLiveKitToken, fetchRealtimeConfig } from "./api";
import { isNativeAndroidApp } from "./nativeAudio";

let realtimeConfigCache = null;

export async function loadRealtimeConfig() {
  if (realtimeConfigCache) {
    return realtimeConfigCache;
  }

  realtimeConfigCache = await fetchRealtimeConfig().catch(() => ({
    transport: {
      defaultMode: "webrtc-direct",
      liveKit: {
        enabled: false,
        url: LIVEKIT_URL || null,
        roomPrefix: "together"
      }
    },
    mobile: {
      nativeBackgroundAudioRequired: true,
      iosRequiresNativeApp: true,
      androidNativeRecommended: true
    }
  }));

  return realtimeConfigCache;
}

export function getMobileRealtimeRecommendation({
  isCompactViewport,
  isIOSDevice,
  isAndroidDevice
}) {
  if (!isCompactViewport) {
    return {
      nativeRecommended: false,
      reason: "desktop-browser-ok"
    };
  }

  if (isNativeAndroidApp()) {
    return {
      nativeRecommended: true,
      reason: "android-native-client"
    };
  }

  if (isIOSDevice) {
    return {
      nativeRecommended: true,
      reason: "ios-background-audio-needs-native"
    };
  }

  if (isAndroidDevice) {
    return {
      nativeRecommended: true,
      reason: "android-background-audio-prefers-native"
    };
  }

  return {
    nativeRecommended: false,
    reason: "browser-fallback"
  };
}

export async function requestLiveKitAccess({
  roomId,
  participantId,
  participantName,
  role,
  canPublish,
  canSubscribe
}) {
  return createLiveKitToken(roomId, {
    participantId,
    participantName,
    role,
    canPublish,
    canSubscribe
  });
}
