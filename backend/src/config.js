require("dotenv").config();

const PORT = Number(process.env.PORT) || 5000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";
const LIVEKIT_URL = process.env.LIVEKIT_URL || "";
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || "";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || "";
const LIVEKIT_DEFAULT_ROOM_PREFIX = process.env.LIVEKIT_DEFAULT_ROOM_PREFIX || "together";
const ENABLE_LIVEKIT = Boolean(LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET);
const DEFAULT_PUBLIC_ORIGINS = [
  "https://together-room.vercel.app",
  "https://together-audio-live.vercel.app",
  "https://together-puce.vercel.app"
];
const ALLOWED_ORIGINS =
  CLIENT_ORIGIN === "*"
    ? "*"
    : Array.from(
        new Set([
          ...CLIENT_ORIGIN.split(",")
            .map((origin) => origin.trim())
            .filter(Boolean),
          ...DEFAULT_PUBLIC_ORIGINS
        ])
      );

module.exports = {
  ALLOWED_ORIGINS,
  CLIENT_ORIGIN,
  ENABLE_LIVEKIT,
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET,
  LIVEKIT_DEFAULT_ROOM_PREFIX,
  LIVEKIT_URL,
  PORT
};
