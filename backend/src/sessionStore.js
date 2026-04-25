const sessions = new Map();

function createRoomId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";

  for (let index = 0; index < 4; index += 1) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  return `ROOM-${suffix}`;
}

function generateUniqueRoomId() {
  let roomId = createRoomId();

  while (sessions.has(roomId)) {
    roomId = createRoomId();
  }

  return roomId;
}

function sanitizeSession(session) {
  if (!session) {
    return null;
  }

  return {
    roomId: session.roomId,
    hostId: session.hostId,
    hostName: session.hostName,
    users: session.users,
    createdAt: session.createdAt,
    status: session.status,
    audioSourceMode: session.audioSourceMode,
    mediaBackend: session.mediaBackend,
    nativeMobileRecommended: session.nativeMobileRecommended,
    liveKitRoomName: session.liveKitRoomName || null
  };
}

function createSession({
  hostId,
  hostName = "Host",
  audioSourceMode = "device-audio",
  mediaBackend = "webrtc-direct",
  nativeMobileRecommended = false,
  liveKitRoomName = null
}) {
  const roomId = generateUniqueRoomId();
  const session = {
    roomId,
    hostId,
    hostName,
    users: [],
    createdAt: Date.now(),
    status: "active",
    audioSourceMode,
    mediaBackend,
    nativeMobileRecommended,
    liveKitRoomName,
    events: [],
    nextEventId: 1
  };

  sessions.set(roomId, session);
  return sanitizeSession(session);
}

function getSession(roomId) {
  return sanitizeSession(sessions.get(roomId));
}

function getRawSession(roomId) {
  return sessions.get(roomId);
}

function updateSession(roomId, updater) {
  const current = sessions.get(roomId);

  if (!current) {
    return null;
  }

  updater(current);
  sessions.set(roomId, current);
  return sanitizeSession(current);
}

function deleteSession(roomId) {
  const session = sessions.get(roomId);

  if (!session) {
    return null;
  }

  sessions.delete(roomId);
  return sanitizeSession(session);
}

module.exports = {
  createSession,
  deleteSession,
  getRawSession,
  getSession,
  updateSession
};
