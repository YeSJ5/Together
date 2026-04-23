require("dotenv").config();

const PORT = Number(process.env.PORT) || 5000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";
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
  PORT
};
