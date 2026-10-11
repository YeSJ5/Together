const fs = require("fs");
const path = require("path");

let DatabaseSync = null;
try {
  const sqlite = require("node:sqlite");
  DatabaseSync = sqlite.DatabaseSync;
} catch (_err) {
  DatabaseSync = null;
}

let pg = null;
try {
  pg = require("pg");
} catch (_err) {
  pg = null;
}

const DEFAULT_DB_PATH = path.resolve(__dirname, "../../data/together.sqlite");

class TogetherDatabase {
  constructor(options = {}) {
    this.databaseUrl = options.databaseUrl !== undefined ? options.databaseUrl : (process.env.DATABASE_URL || null);
    this.requirePostgres = options.requirePostgres !== undefined
      ? Boolean(options.requirePostgres)
      : (process.env.REQUIRE_POSTGRES === "true" || process.env.REQUIRE_POSTGRES === "1");
    this.dbPath = options.dbPath || process.env.TOGETHER_DB_PATH || DEFAULT_DB_PATH;
    this.pgPool = null;
    this.db = null;
    this.isPg = Boolean(this.databaseUrl && (this.databaseUrl.startsWith("postgres://") || this.databaseUrl.startsWith("postgresql://")) && pg);
    this.isSqlite = !this.isPg && !this.requirePostgres && Boolean(DatabaseSync);
    this.cache = {
      rooms: new Map(),
      user_profiles: new Map(),
      room_events: []
    };
    this.jsonStore = {
      rooms: new Map(),
      user_profiles: new Map(),
      room_events: []
    };
    this.readyPromise = null;
    this.syncInterval = null;
    this.initError = null;

    this.init();
  }

  getDriverName() {
    if (this.isPg) return "postgresql";
    if (this.isSqlite) return "sqlite";
    return "json-journal";
  }

  async waitForReady() {
    if (this.readyPromise) {
      await this.readyPromise;
    }
    return this;
  }

  init() {
    if (this.requirePostgres) {
      if (!this.isPg) {
        const reason = !this.databaseUrl
          ? "REQUIRE_POSTGRES is enabled but DATABASE_URL is not configured."
          : (!pg
              ? "REQUIRE_POSTGRES is enabled but 'pg' driver module is not available."
              : "REQUIRE_POSTGRES is enabled but DATABASE_URL is not a valid postgresql:// connection string.");
        console.error(`[DB] FATAL: ${reason}`);
        this.initError = reason;
        this.isPg = true;
        this.isSqlite = false;
        return;
      }
    }

    if (this.isPg) {
      console.log("[DB] Detected DATABASE_URL. Initializing PostgreSQL adapter...");
      try {
        const poolConfig = {
          connectionString: this.databaseUrl,
          max: 10,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000
        };

        // Render / Supabase / Neon / Heroku Postgres SSL
        if (!this.databaseUrl.includes("localhost") && !this.databaseUrl.includes("127.0.0.1")) {
          poolConfig.ssl = { rejectUnauthorized: false };
        }

        this.pgPool = new pg.Pool(poolConfig);
        this.readyPromise = this.runPgMigrations()
          .then(() => this.hydratePgCache())
          .then(() => {
            // Periodic sync from PostgreSQL to ensure multi-instance consistency
            if (!this.syncInterval) {
              this.syncInterval = setInterval(() => {
                this.hydratePgCache().catch(() => {});
              }, 15000);
              if (this.syncInterval.unref) this.syncInterval.unref();
            }
            console.log("[DB] PostgreSQL adapter initialized successfully. Migrations applied and cache hydrated.");
          })
          .catch((err) => {
            console.error("[DB] PostgreSQL migration or cache hydration failed:", err.message);
            this.initError = err.message;
          });
        return;
      } catch (err) {
        console.error("[DB] PostgreSQL initialization failed:", err.message);
        this.initError = err.message;
        if (this.requirePostgres) {
          return;
        }
        console.warn("[DB] Falling back to SQLite/JSON store...");
        this.isPg = false;
        this.pgPool = null;
      }
    }

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
        this.runSqliteMigrations();
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

  async runPgMigrations() {
    if (!this.pgPool) return;
    const client = await this.pgPool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at BIGINT NOT NULL
        );
      `);

      const res = await client.query("SELECT MAX(version) as version FROM schema_migrations");
      const currentVersion = Number(res.rows[0]?.version) || 0;

      if (currentVersion < 1) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS rooms (
            room_id VARCHAR(64) PRIMARY KEY,
            title VARCHAR(255) NOT NULL,
            category VARCHAR(64) NOT NULL DEFAULT 'Music',
            is_public INTEGER NOT NULL DEFAULT 1,
            host_id VARCHAR(128) NOT NULL,
            host_name VARCHAR(128) NOT NULL,
            host_key VARCHAR(128),
            audio_source_mode VARCHAR(64) NOT NULL DEFAULT 'universal',
            media_backend VARCHAR(64) NOT NULL DEFAULT 'webrtc-direct',
            status VARCHAR(32) NOT NULL DEFAULT 'active',
            current_track TEXT,
            livekit_room_name VARCHAR(128),
            native_mobile_recommended INTEGER DEFAULT 0,
            created_at BIGINT NOT NULL,
            updated_at BIGINT NOT NULL,
            ended_at BIGINT
          );

          CREATE INDEX IF NOT EXISTS idx_rooms_status_public ON rooms(status, is_public);

          CREATE TABLE IF NOT EXISTS user_profiles (
            user_id VARCHAR(128) PRIMARY KEY,
            username VARCHAR(128) NOT NULL,
            role VARCHAR(64) NOT NULL DEFAULT 'listener',
            created_at BIGINT NOT NULL,
            last_seen_at BIGINT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS room_events (
            id BIGSERIAL PRIMARY KEY,
            room_id VARCHAR(64) NOT NULL,
            event_type VARCHAR(64) NOT NULL,
            sender_id VARCHAR(128) NOT NULL,
            target_id VARCHAR(128),
            payload TEXT,
            created_at BIGINT NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_events_room_id ON room_events(room_id);

          INSERT INTO schema_migrations (version, applied_at) VALUES (1, ${Date.now()});
        `);
      }

      if (currentVersion < 2) {
        await client.query(`
          ALTER TABLE rooms ADD COLUMN IF NOT EXISTS host_key VARCHAR(128);
          INSERT INTO schema_migrations (version, applied_at) VALUES (2, ${Date.now()});
        `);
      }
    } finally {
      client.release();
    }
  }

  async hydratePgCache() {
    if (!this.pgPool) return;
    try {
      const roomRes = await this.pgPool.query(
        "SELECT * FROM rooms WHERE status = 'active' ORDER BY created_at DESC LIMIT 200"
      );
      for (const row of roomRes.rows || []) {
        const formatted = this.formatRoomRow(row);
        this.cache.rooms.set(formatted.roomId, formatted);
      }

      const profileRes = await this.pgPool.query(
        "SELECT * FROM user_profiles ORDER BY last_seen_at DESC LIMIT 500"
      );
      for (const row of profileRes.rows || []) {
        this.cache.user_profiles.set(row.user_id, {
          userId: row.user_id,
          username: row.username,
          role: row.role,
          createdAt: Number(row.created_at),
          lastSeenAt: Number(row.last_seen_at)
        });
      }
    } catch (err) {
      console.warn("[DB] Could not hydrate PostgreSQL cache:", err.message);
    }
  }

  runSqliteMigrations() {
    if (!this.isSqlite || !this.db) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `);

    const appliedRow = this.db.prepare("SELECT MAX(version) as version FROM schema_migrations").get();
    const currentVersion = appliedRow?.version || 0;

    if (currentVersion < 1) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS rooms (
          room_id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'Music',
          is_public INTEGER NOT NULL DEFAULT 1,
          host_id TEXT NOT NULL,
          host_name TEXT NOT NULL,
          host_key TEXT,
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

        INSERT INTO schema_migrations (version, applied_at) VALUES (1, ${Date.now()});
      `);
    }

    if (currentVersion < 2) {
      try {
        this.db.exec(`
          ALTER TABLE rooms ADD COLUMN host_key TEXT;
        `);
      } catch (_e) {
        // column may already exist
      }
      const insertStmt = this.db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)");
      insertStmt.run(2, Date.now());
    }
  }

  // Room methods
  upsertRoom(room) {
    const now = Date.now();
    const currentTrackJson = room.currentTrack ? JSON.stringify(room.currentTrack) : null;

    const prev = this.cache.rooms.get(room.roomId);
    this.cache.rooms.set(room.roomId, {
      ...room,
      updatedAt: now
    });

    if (this.isPg && this.pgPool) {
      const query = `
        INSERT INTO rooms (
          room_id, title, category, is_public, host_id, host_name, host_key,
          audio_source_mode, media_backend, status, current_track,
          livekit_room_name, native_mobile_recommended, created_at, updated_at, ended_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT(room_id) DO UPDATE SET
          title = EXCLUDED.title,
          category = EXCLUDED.category,
          is_public = EXCLUDED.is_public,
          host_id = EXCLUDED.host_id,
          host_name = EXCLUDED.host_name,
          host_key = COALESCE(EXCLUDED.host_key, rooms.host_key),
          audio_source_mode = EXCLUDED.audio_source_mode,
          media_backend = EXCLUDED.media_backend,
          status = EXCLUDED.status,
          current_track = EXCLUDED.current_track,
          livekit_room_name = EXCLUDED.livekit_room_name,
          native_mobile_recommended = EXCLUDED.native_mobile_recommended,
          updated_at = EXCLUDED.updated_at,
          ended_at = EXCLUDED.ended_at;
      `;
      this.pgPool.query(query, [
        room.roomId,
        room.title || "Room",
        room.category || "Music",
        room.isPublic ? 1 : 0,
        room.hostId,
        room.hostName || "Host",
        room.hostKey || null,
        room.audioSourceMode || "universal",
        room.mediaBackend || "webrtc-direct",
        room.status || "active",
        currentTrackJson,
        room.liveKitRoomName || null,
        room.nativeMobileRecommended ? 1 : 0,
        room.createdAt || now,
        now,
        room.endedAt || null
      ]).catch((e) => {
        console.error("[DB PG] upsertRoom error - reverting cache:", e.message);
        if (prev) {
          this.cache.rooms.set(room.roomId, prev);
        } else {
          this.cache.rooms.delete(room.roomId);
        }
      });
      return;
    }

    if (this.isSqlite && this.db) {
      const stmt = this.db.prepare(`
        INSERT INTO rooms (
          room_id, title, category, is_public, host_id, host_name, host_key,
          audio_source_mode, media_backend, status, current_track,
          livekit_room_name, native_mobile_recommended, created_at, updated_at, ended_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(room_id) DO UPDATE SET
          title = excluded.title,
          category = excluded.category,
          is_public = excluded.is_public,
          host_id = excluded.host_id,
          host_name = excluded.host_name,
          host_key = COALESCE(excluded.host_key, rooms.host_key),
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
        room.hostKey || null,
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

  async upsertRoomAsync(room) {
    const now = Date.now();
    const currentTrackJson = room.currentTrack ? JSON.stringify(room.currentTrack) : null;

    if (this.isPg && this.pgPool) {
      await this.waitForReady();
      const query = `
        INSERT INTO rooms (
          room_id, title, category, is_public, host_id, host_name, host_key,
          audio_source_mode, media_backend, status, current_track,
          livekit_room_name, native_mobile_recommended, created_at, updated_at, ended_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT(room_id) DO UPDATE SET
          title = EXCLUDED.title,
          category = EXCLUDED.category,
          is_public = EXCLUDED.is_public,
          host_id = EXCLUDED.host_id,
          host_name = EXCLUDED.host_name,
          host_key = COALESCE(EXCLUDED.host_key, rooms.host_key),
          audio_source_mode = EXCLUDED.audio_source_mode,
          media_backend = EXCLUDED.media_backend,
          status = EXCLUDED.status,
          current_track = EXCLUDED.current_track,
          livekit_room_name = EXCLUDED.livekit_room_name,
          native_mobile_recommended = EXCLUDED.native_mobile_recommended,
          updated_at = EXCLUDED.updated_at,
          ended_at = EXCLUDED.ended_at;
      `;
      await this.pgPool.query(query, [
        room.roomId,
        room.title || "Room",
        room.category || "Music",
        room.isPublic ? 1 : 0,
        room.hostId,
        room.hostName || "Host",
        room.hostKey || null,
        room.audioSourceMode || "universal",
        room.mediaBackend || "webrtc-direct",
        room.status || "active",
        currentTrackJson,
        room.liveKitRoomName || null,
        room.nativeMobileRecommended ? 1 : 0,
        room.createdAt || now,
        now,
        room.endedAt || null
      ]);
      const updated = { ...room, updatedAt: now };
      this.cache.rooms.set(room.roomId, updated);
      return updated;
    }

    this.upsertRoom(room);
    return this.getRoom(room.roomId);
  }

  getRoom(roomId) {
    if (!roomId) return null;

    if (this.isSqlite && this.db) {
      const row = this.db.prepare("SELECT * FROM rooms WHERE room_id = ?").get(roomId);
      if (!row) return null;
      return this.formatRoomRow(row);
    }

    if (this.isPg) {
      const room = this.cache.rooms.get(roomId);
      return room ? { ...room } : null;
    }

    const room = this.jsonStore.rooms.get(roomId);
    return room ? { ...room } : null;
  }

  async getRoomAsync(roomId, { forceRefresh = false } = {}) {
    if (!roomId) return null;

    if (this.isPg && this.pgPool) {
      await this.waitForReady();
      if (!forceRefresh && this.cache.rooms.has(roomId)) {
        return { ...this.cache.rooms.get(roomId) };
      }
      try {
        const res = await this.pgPool.query("SELECT * FROM rooms WHERE room_id = $1", [roomId]);
        if (res.rows?.[0]) {
          const formatted = this.formatRoomRow(res.rows[0]);
          this.cache.rooms.set(roomId, formatted);
          return formatted;
        } else {
          this.cache.rooms.delete(roomId);
          return null;
        }
      } catch (err) {
        console.warn("[DB PG] getRoomAsync error, using cache:", err.message);
        return this.getRoom(roomId);
      }
    }

    return this.getRoom(roomId);
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

    if (this.isPg) {
      const res = [];
      for (const r of this.cache.rooms.values()) {
        if (r.status === "active" && r.isPublic !== false) {
          res.push({ ...r });
        }
      }
      return res.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }

    const res = [];
    for (const r of this.jsonStore.rooms.values()) {
      if (r.status === "active" && r.isPublic !== false) {
        res.push({ ...r });
      }
    }
    return res.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  async listPublicActiveRoomsAsync() {
    if (this.isPg && this.pgPool) {
      await this.waitForReady();
      try {
        const res = await this.pgPool.query(
          "SELECT * FROM rooms WHERE status = 'active' AND is_public = 1 ORDER BY created_at DESC LIMIT 200"
        );
        const rooms = (res.rows || []).map((r) => this.formatRoomRow(r));
        for (const room of rooms) {
          this.cache.rooms.set(room.roomId, room);
        }
        return rooms;
      } catch (err) {
        console.warn("[DB PG] listPublicActiveRoomsAsync error, falling back to cache:", err.message);
        return this.listPublicActiveRooms();
      }
    }

    return this.listPublicActiveRooms();
  }

  deleteOrEndRoom(roomId) {
    const now = Date.now();

    const cached = this.cache.rooms.get(roomId);
    if (cached) {
      cached.status = "ended";
      cached.endedAt = now;
      cached.updatedAt = now;
    }

    if (this.isPg && this.pgPool) {
      this.pgPool.query(
        "UPDATE rooms SET status = 'ended', ended_at = $1, updated_at = $2 WHERE room_id = $3",
        [now, now, roomId]
      ).catch((e) => console.error("[DB PG] deleteOrEndRoom error:", e.message));
    }

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
    return room || cached || null;
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
      hostKey: row.host_key || null,
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

    this.cache.user_profiles.set(userId, {
      userId,
      username: username || "User",
      role: role || "listener",
      createdAt: now,
      lastSeenAt: now
    });

    if (this.isPg && this.pgPool) {
      this.pgPool.query(`
        INSERT INTO user_profiles (user_id, username, role, created_at, last_seen_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT(user_id) DO UPDATE SET
          username = EXCLUDED.username,
          last_seen_at = EXCLUDED.last_seen_at;
      `, [userId, username || "User", role, now, now]).catch(() => {});
      return;
    }

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

    if (this.isPg) {
      return this.cache.user_profiles.get(userId) || null;
    }

    return this.jsonStore.user_profiles.get(userId) || null;
  }

  appendRoomEvent(roomId, eventType, senderId, targetId = null, payload = {}) {
    const now = Date.now();
    const payloadStr = JSON.stringify(payload || {});

    if (this.isPg && this.pgPool) {
      this.pgPool.query(`
        INSERT INTO room_events (room_id, event_type, sender_id, target_id, payload, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [roomId, eventType, senderId, targetId, payloadStr, now]).catch(() => {});
      return;
    }

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

  cleanupStaleRooms(maxAgeMs = 24 * 60 * 60 * 1000) {
    const cutoff = Date.now() - maxAgeMs;
    const now = Date.now();

    if (this.isPg && this.pgPool) {
      this.pgPool.query(
        "UPDATE rooms SET status = 'ended', ended_at = $1, updated_at = $2 WHERE status = 'active' AND created_at < $3",
        [now, now, cutoff]
      ).catch(() => {});
    }

    if (this.isSqlite && this.db) {
      const stmt = this.db.prepare(`
        UPDATE rooms
        SET status = 'ended', ended_at = ?, updated_at = ?
        WHERE status = 'active' AND created_at < ?
      `);
      stmt.run(now, now, cutoff);
    } else {
      for (const room of this.jsonStore.rooms.values()) {
        if (room.status === "active" && room.createdAt < cutoff) {
          room.status = "ended";
          room.endedAt = now;
        }
      }
      this.persistJsonStore();
    }
  }

  async checkHealth() {
    try {
      if (this.isPg) {
        if (this.initError) {
          return {
            status: "degraded",
            driver: "postgresql",
            storageType: "managed-cloud",
            healthy: false,
            error: this.initError
          };
        }
        if (!this.pgPool) {
          return {
            status: "degraded",
            driver: "postgresql",
            storageType: "managed-cloud",
            healthy: false,
            error: "PostgreSQL pool uninitialized"
          };
        }
        const res = await this.pgPool.query("SELECT 1 as alive");
        return {
          status: "connected",
          driver: "postgresql",
          storageType: "managed-cloud",
          healthy: res.rows?.[0]?.alive === 1
        };
      }

      if (this.isSqlite && this.db) {
        const res = this.db.prepare("SELECT 1 as alive").get();
        const isRenderEphemeral = Boolean(process.env.RENDER) && !process.env.TOGETHER_PERSISTENT_DISK;
        return {
          status: "connected",
          driver: "sqlite",
          storageType: isRenderEphemeral ? "ephemeral-container" : "local-disk",
          healthy: res?.alive === 1
        };
      }

      return {
        status: "connected",
        driver: "json-journal",
        storageType: "ephemeral-journal",
        healthy: true
      };
    } catch (err) {
      return {
        status: "degraded",
        driver: this.getDriverName(),
        storageType: this.isPg ? "managed-cloud" : (this.isSqlite ? (process.env.RENDER && !process.env.TOGETHER_PERSISTENT_DISK ? "ephemeral-container" : "local-disk") : "ephemeral-journal"),
        healthy: false,
        error: err.message
      };
    }
  }

  close() {
    if (this.syncInterval) {
      try {
        clearInterval(this.syncInterval);
        this.syncInterval = null;
      } catch (_e) {}
    }
    if (this.pgPool) {
      try {
        this.pgPool.end().catch(() => {});
      } catch (_e) {}
    }
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
    instance = new TogetherDatabase({ dbPath });
  }
  return instance;
}

function resetDatabaseForTesting() {
  if (instance) {
    instance.close();
  }
  instance = new TogetherDatabase({ dbPath: ":memory:" });
  return instance;
}

module.exports = {
  TogetherDatabase,
  getDatabase,
  resetDatabaseForTesting
};
