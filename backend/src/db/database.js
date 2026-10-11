const fs = require("fs");
const path = require("path");

let DatabaseSync = null;
try {
  const sqlite = require("node:sqlite");
  DatabaseSync = sqlite.DatabaseSync;
} catch (_err) {
  DatabaseSync = null;
}

const DEFAULT_DB_PATH = path.resolve(__dirname, "../../data/together.sqlite");

class TogetherDatabase {
  constructor(dbPath = process.env.TOGETHER_DB_PATH || DEFAULT_DB_PATH) {
    this.dbPath = dbPath;
    this.isSqlite = Boolean(DatabaseSync);
    this.db = null;
    this.jsonStore = {
      rooms: new Map(),
      user_profiles: new Map(),
      room_events: []
    };
    this.init();
  }

  init() {
    if (this.isSqlite) {
      try {
        if (this.dbPath !== ":memory:") {
          const dir = path.dirname(this.dbPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
        }
        this.db = new DatabaseSync(this.dbPath);
        this.db.exec("PRAGMA journal_mode = WAL;");
        this.db.exec("PRAGMA busy_timeout = 5000;");
        this.runMigrations();
        return;
      } catch (err) {
        console.warn("[DB] node:sqlite initialization failed, falling back to durable JSON store:", err.message);
        this.isSqlite = false;
        this.db = null;
      }
    }

    // Fallback: Durable JSON store
    this.initJsonStore();
  }

  initJsonStore() {
    this.fallbackFilePath = this.dbPath !== ":memory:"
      ? (this.dbPath.endsWith(".sqlite") ? this.dbPath.replace(".sqlite", ".json") : `${this.dbPath}.json`)
      : null;

    if (this.fallbackFilePath && fs.existsSync(this.fallbackFilePath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.fallbackFilePath, "utf8"));
        if (raw.rooms) {
          for (const [k, v] of Object.entries(raw.rooms)) {
            this.jsonStore.rooms.set(k, v);
          }
        }
        if (raw.user_profiles) {
          for (const [k, v] of Object.entries(raw.user_profiles)) {
            this.jsonStore.user_profiles.set(k, v);
          }
        }
        if (Array.isArray(raw.room_events)) {
          this.jsonStore.room_events = raw.room_events;
        }
      } catch (_e) {}
    }
  }

  persistJsonStore() {
    if (!this.fallbackFilePath) return;
    try {
      const dir = path.dirname(this.fallbackFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = {
        rooms: Object.fromEntries(this.jsonStore.rooms),
        user_profiles: Object.fromEntries(this.jsonStore.user_profiles),
        room_events: this.jsonStore.room_events.slice(-500)
      };
      fs.writeFileSync(this.fallbackFilePath, JSON.stringify(data, null, 2), "utf8");
    } catch (_e) {}
  }

  runMigrations() {
    if (!this.isSqlite || !this.db) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `);

    const appliedRow = this.db.prepare("SELECT MAX(version) as version FROM schema_migrations").get();
    const currentVersion = appliedRow?.version || 0;

    const migrations = [
      {
        version: 1,
        up: `
          CREATE TABLE IF NOT EXISTS rooms (
            room_id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT 'Music',
            is_public INTEGER NOT NULL DEFAULT 1,
            host_id TEXT NOT NULL,
            host_name TEXT NOT NULL,
            audio_source_mode TEXT NOT NULL DEFAULT 'universal',
            media_backend TEXT NOT NULL DEFAULT 'webrtc-direct',
            status TEXT NOT NULL DEFAULT 'active',
            current_track TEXT,
            livekit_room_name TEXT,
            native_mobile_recommended INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            ended_at INTEGER
          );

          CREATE INDEX IF NOT EXISTS idx_rooms_status_public ON rooms(status, is_public);

          CREATE TABLE IF NOT EXISTS user_profiles (
            user_id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'listener',
            created_at INTEGER NOT NULL,
            last_seen_at INTEGER NOT NULL
          );

          CREATE TABLE IF NOT EXISTS room_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            sender_id TEXT NOT NULL,
            target_id TEXT,
            payload TEXT,
            created_at INTEGER NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_events_room_id ON room_events(room_id);
        `
      }
    ];

    for (const migration of migrations) {
      if (migration.version > currentVersion) {
        this.db.exec(migration.up);
        const insertStmt = this.db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)");
        insertStmt.run(migration.version, Date.now());
      }
    }
  }

  // Room methods
  upsertRoom(room) {
    const now = Date.now();
    const currentTrackJson = room.currentTrack ? JSON.stringify(room.currentTrack) : null;

    if (this.isSqlite && this.db) {
      const stmt = this.db.prepare(`
        INSERT INTO rooms (
          room_id, title, category, is_public, host_id, host_name,
          audio_source_mode, media_backend, status, current_track,
          livekit_room_name, native_mobile_recommended, created_at, updated_at, ended_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(room_id) DO UPDATE SET
          title = excluded.title,
          category = excluded.category,
          is_public = excluded.is_public,
          host_id = excluded.host_id,
          host_name = excluded.host_name,
          audio_source_mode = excluded.audio_source_mode,
          media_backend = excluded.media_backend,
          status = excluded.status,
          current_track = excluded.current_track,
          livekit_room_name = excluded.livekit_room_name,
          native_mobile_recommended = excluded.native_mobile_recommended,
          updated_at = excluded.updated_at,
          ended_at = excluded.ended_at;
      `);

      stmt.run(
        room.roomId,
        room.title || "Room",
        room.category || "Music",
        room.isPublic ? 1 : 0,
        room.hostId,
        room.hostName || "Host",
        room.audioSourceMode || "universal",
        room.mediaBackend || "webrtc-direct",
        room.status || "active",
        currentTrackJson,
        room.liveKitRoomName || null,
        room.nativeMobileRecommended ? 1 : 0,
        room.createdAt || now,
        now,
        room.endedAt || null
      );
    } else {
      this.jsonStore.rooms.set(room.roomId, {
        ...room,
        updatedAt: now
      });
      this.persistJsonStore();
    }
  }

  getRoom(roomId) {
    if (!roomId) return null;

    if (this.isSqlite && this.db) {
      const row = this.db.prepare("SELECT * FROM rooms WHERE room_id = ?").get(roomId);
      if (!row) return null;
      return this.formatRoomRow(row);
    }

    const room = this.jsonStore.rooms.get(roomId);
    return room ? { ...room } : null;
  }

  listPublicActiveRooms() {
    if (this.isSqlite && this.db) {
      const rows = this.db.prepare(`
        SELECT * FROM rooms
        WHERE status = 'active' AND is_public = 1
        ORDER BY created_at DESC
      `).all();
      return rows.map((r) => this.formatRoomRow(r));
    }

    const res = [];
    for (const r of this.jsonStore.rooms.values()) {
      if (r.status === "active" && r.isPublic !== false) {
        res.push({ ...r });
      }
    }
    return res.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  deleteOrEndRoom(roomId) {
    const now = Date.now();
    if (this.isSqlite && this.db) {
      const stmt = this.db.prepare("UPDATE rooms SET status = 'ended', ended_at = ?, updated_at = ? WHERE room_id = ?");
      stmt.run(now, now, roomId);
      return this.getRoom(roomId);
    }

    const room = this.jsonStore.rooms.get(roomId);
    if (room) {
      room.status = "ended";
      room.endedAt = now;
      room.updatedAt = now;
      this.persistJsonStore();
    }
    return room || null;
  }

  formatRoomRow(row) {
    let currentTrack = null;
    if (row.current_track) {
      try {
        currentTrack = JSON.parse(row.current_track);
      } catch (_e) {}
    }

    return {
      roomId: row.room_id,
      title: row.title,
      category: row.category,
      isPublic: Boolean(row.is_public),
      hostId: row.host_id,
      hostName: row.host_name,
      audioSourceMode: row.audio_source_mode,
      mediaBackend: row.media_backend,
      status: row.status,
      currentTrack,
      liveKitRoomName: row.livekit_room_name,
      nativeMobileRecommended: Boolean(row.native_mobile_recommended),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      endedAt: row.ended_at ? Number(row.ended_at) : null
    };
  }

  // User Profile methods
  upsertUserProfile(userId, username, role = "listener") {
    if (!userId) return;
    const now = Date.now();

    if (this.isSqlite && this.db) {
      const stmt = this.db.prepare(`
        INSERT INTO user_profiles (user_id, username, role, created_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          username = excluded.username,
          last_seen_at = excluded.last_seen_at;
      `);
      stmt.run(userId, username || "User", role, now, now);
    } else {
      const existing = this.jsonStore.user_profiles.get(userId);
      this.jsonStore.user_profiles.set(userId, {
        userId,
        username: username || (existing?.username || "User"),
        role: role || (existing?.role || "listener"),
        createdAt: existing?.createdAt || now,
        lastSeenAt: now
      });
      this.persistJsonStore();
    }
  }

  getUserProfile(userId) {
    if (!userId) return null;

    if (this.isSqlite && this.db) {
      const row = this.db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").get(userId);
      if (!row) return null;
      return {
        userId: row.user_id,
        username: row.username,
        role: row.role,
        createdAt: Number(row.created_at),
        lastSeenAt: Number(row.last_seen_at)
      };
    }

    return this.jsonStore.user_profiles.get(userId) || null;
  }

  // Events / audit log
  appendRoomEvent(roomId, eventType, senderId, targetId = null, payload = {}) {
    const now = Date.now();
    const payloadStr = JSON.stringify(payload || {});

    if (this.isSqlite && this.db) {
      const stmt = this.db.prepare(`
        INSERT INTO room_events (room_id, event_type, sender_id, target_id, payload, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(roomId, eventType, senderId, targetId, payloadStr, now);
    } else {
      this.jsonStore.room_events.push({
        roomId,
        eventType,
        senderId,
        targetId,
        payload,
        createdAt: now
      });
    }
  }

  // Maintenance & cleanup
  cleanupStaleRooms(maxAgeMs = 24 * 60 * 60 * 1000) {
    const cutoff = Date.now() - maxAgeMs;

    if (this.isSqlite && this.db) {
      const stmt = this.db.prepare(`
        UPDATE rooms
        SET status = 'ended', ended_at = ?, updated_at = ?
        WHERE status = 'active' AND created_at < ?
      `);
      const now = Date.now();
      stmt.run(now, now, cutoff);
    } else {
      for (const room of this.jsonStore.rooms.values()) {
        if (room.status === "active" && room.createdAt < cutoff) {
          room.status = "ended";
          room.endedAt = Date.now();
        }
      }
      this.persistJsonStore();
    }
  }

  close() {
    if (this.isSqlite && this.db) {
      try {
        this.db.close();
      } catch (_e) {}
    }
  }
}

let instance = null;

function getDatabase(dbPath) {
  if (!instance) {
    instance = new TogetherDatabase(dbPath);
  }
  return instance;
}

function resetDatabaseForTesting() {
  if (instance) {
    instance.close();
  }
  instance = new TogetherDatabase(":memory:");
  return instance;
}

module.exports = {
  TogetherDatabase,
  getDatabase,
  resetDatabaseForTesting
};
