const { AccessToken } = require("livekit-server-sdk");
const {
  ENABLE_LIVEKIT,
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET,
  LIVEKIT_DEFAULT_ROOM_PREFIX,
  LIVEKIT_URL
} = require("./config");

function sanitizeIdentity(value, fallback) {
  return String(value || fallback || "participant")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 64);
}

function getLiveKitRoomName(roomId) {
  return `${LIVEKIT_DEFAULT_ROOM_PREFIX}-${roomId}`.toLowerCase();
}

function getLiveKitConfig() {
  return {
    enabled: ENABLE_LIVEKIT,
    url: LIVEKIT_URL || null,
    roomPrefix: LIVEKIT_DEFAULT_ROOM_PREFIX
  };
}

async function createLiveKitToken({
  roomId,
  participantId,
  participantName,
  role = "listener",
  canPublish = false,
  canSubscribe = true,
  canPublishData = true
}) {
  if (!ENABLE_LIVEKIT) {
    throw new Error("LiveKit is not configured on this backend.");
  }

  const identity = sanitizeIdentity(participantId, role);
  const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity,
    name: participantName || identity,
    ttl: "12h"
  });

  token.addGrant({
    roomJoin: true,
    room: getLiveKitRoomName(roomId),
    canPublish,
    canSubscribe,
    canPublishData
  });

  return {
    token: await token.toJwt(),
    url: LIVEKIT_URL,
    roomName: getLiveKitRoomName(roomId),
    participantIdentity: identity,
    participantName: participantName || identity,
    role
  };
}

module.exports = {
  createLiveKitToken,
  getLiveKitConfig,
  getLiveKitRoomName
};
