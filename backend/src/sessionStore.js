const crypto = require("crypto");
const { getDatabase } = require("./db/database");

const sessions = new Map();
const db = getDatabase();

const VALID_CATEGORIES = ["Music", "Podcast", "Study", "Lecture", "DJ", "General"];

// Restore recent active rooms from durable database into memory
try {
  const persistedRooms = db.listPublicActiveRooms();
  for (const room of persistedRooms) {
    if (!sessions.has(room.roomId)) {
      sessions.set(room.roomId, {
        roomId: room.roomId,
        title: room.title,
        category: room.category,
        isPublic: room.isPublic,
        hostId: room.hostId,
        hostName: room.hostName,
        hostKey: room.hostKey || null,
        users: [],
        createdAt: room.createdAt,
        status: room.status,
        audioSourceMode: room.audioSourceMode,
        mediaBackend: room.mediaBackend,
        nativeMobileRecommended: room.nativeMobileRecommended,
        liveKitRoomName: room.liveKitRoomName,
        currentTrack: room.currentTrack,
        events: [],
        nextEventId: 1
      });
    }
  }
} catch (e) {
  console.warn("[sessionStore] Could not hydrate sessions from database:", e.message);
}

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

  while (sessions.has(roomId) || (db && db.getRoom(roomId))) {
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
    title: session.title || `${session.hostName}'s Room`,
    category: session.category || "Music",
    isPublic: session.isPublic !== false,
    hostId: session.hostId,
    hostName: session.hostName,
    users: session.users || [],
    createdAt: session.createdAt,
    status: session.status,
    audioSourceMode: session.audioSourceMode,
    mediaBackend: session.mediaBackend,
    nativeMobileRecommended: session.nativeMobileRecommended,
    liveKitRoomName: session.liveKitRoomName || null,
    currentTrack: session.currentTrack || null
  };
}

function createSession({
  hostId,
  hostName = "Host",
  title = "",
  category = "Music",
  isPublic = true,
  audioSourceMode = "universal",
  mediaBackend = "webrtc-direct",
  nativeMobileRecommended = false,
  liveKitRoomName = null
}) {
  const roomId = generateUniqueRoomId();
  const sanitizedTitle = String(title || "").trim().slice(0, 100);
  const sanitizedHostName = String(hostName || "Host").trim().slice(0, 40);
  const sanitizedCategory = VALID_CATEGORIES.includes(category) ? category : "Music";
  const hostKey = crypto.randomBytes(24).toString("hex");

  const session = {
    roomId,
    title: sanitizedTitle || `${sanitizedHostName}'s Room`,
    category: sanitizedCategory,
    isPublic: Boolean(isPublic),
    hostId,
    hostName: sanitizedHostName,
    hostKey,
    users: [],
    createdAt: Date.now(),
    status: "active",
    audioSourceMode,
    mediaBackend,
    nativeMobileRecommended,
    liveKitRoomName,
    currentTrack: null,
    events: [],
    nextEventId: 1
  };

  sessions.set(roomId, session);

  try {
    db.upsertRoom(session);
    db.upsertUserProfile(hostId, sanitizedHostName, "host");
    db.appendRoomEvent(roomId, "room-created", hostId, null, {
      title: session.title,
      category: session.category
    });
  } catch (err) {
    console.error("[sessionStore] Database error during createSession:", err.message);
  }

  return {
    ...sanitizeSession(session),
    hostKey
  };
}

function listActivePublicSessions() {
  const result = [];
  for (const session of sessions.values()) {
    if (session.status === "active" && session.isPublic !== false) {
      result.push(sanitizeSession(session));
    }
  }
  return result.sort((a, b) => {
    const diff = (b.users?.length || 0) - (a.users?.length || 0);
    return diff !== 0 ? diff : b.createdAt - a.createdAt;
  });
}

function getSession(roomId) {
  const inMemory = sessions.get(roomId);
  if (inMemory) {
    return sanitizeSession(inMemory);
  }

  const persisted = db.getRoom(roomId);
  if (persisted && persisted.status === "active") {
    const restored = {
      ...persisted,
      users: [],
      events: [],
      nextEventId: 1
    };
    sessions.set(roomId, restored);
    return sanitizeSession(restored);
  }

  return null;
}

function getRawSession(roomId) {
  let session = sessions.get(roomId);
  if (!session) {
    const persisted = db.getRoom(roomId);
    if (persisted && persisted.status === "active") {
      session = {
        ...persisted,
        users: [],
        events: [],
        nextEventId: 1
      };
      sessions.set(roomId, session);
    }
  }
  return session;
}

function verifyHostKey(roomId, candidateKey) {
  if (!roomId || !candidateKey) return false;
  const raw = getRawSession(roomId);
  if (!raw) return false;
  if (!raw.hostKey) {
    return raw.hostId === candidateKey;
  }
  const expected = Buffer.from(String(raw.hostKey));
  const candidate = Buffer.from(String(candidateKey));
  if (expected.length !== candidate.length) return false;
  return crypto.timingSafeEqual(expected, candidate);
}

function updateSession(roomId, updater) {
  const current = getRawSession(roomId);

  if (!current) {
    return null;
  }

  updater(current);
  sessions.set(roomId, current);

  try {
    db.upsertRoom(current);
  } catch (err) {
    console.error("[sessionStore] Database error during updateSession:", err.message);
  }

  return sanitizeSession(current);
}

function deleteSession(roomId) {
  const session = sessions.get(roomId);

  if (!session) {
    const persisted = db.getRoom(roomId);
    if (persisted) {
      db.deleteOrEndRoom(roomId);
      return sanitizeSession(persisted);
    }
    return null;
  }

  sessions.delete(roomId);

  try {
    db.deleteOrEndRoom(roomId);
    db.appendRoomEvent(roomId, "room-ended", session.hostId, null, {
      durationMs: Date.now() - session.createdAt
    });
  } catch (err) {
    console.error("[sessionStore] Database error during deleteSession:", err.message);
  }

  return sanitizeSession(session);
}

function clearAllSessionsForTesting() {
  sessions.clear();
}

module.exports = {
  createSession,
  deleteSession,
  getRawSession,
  getSession,
  listActivePublicSessions,
  updateSession,
  verifyHostKey,
  clearAllSessionsForTesting,
  getDatabase: () => db
};
