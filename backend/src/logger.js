const SENSITIVE_KEYS = new Set([
  "password",
  "token",
  "secret",
  "credential",
  "authorization",
  "cookie"
]);

function sanitize(data) {
  if (data === null || data === undefined) return data;
  if (typeof data !== "object") return data;

  if (Array.isArray(data)) {
    return data.map(sanitize);
  }

  const result = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "object") {
      result[key] = sanitize(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

const isProduction = process.env.NODE_ENV === "production";

function log(level, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const entry = {
    timestamp,
    level,
    message,
    ...sanitize(meta)
  };

  if (isProduction) {
    process.stdout.write(JSON.stringify(entry) + "\n");
  } else {
    const metaStr = Object.keys(meta).length > 0 ? " " + JSON.stringify(sanitize(meta)) : "";
    if (level === "error") {
      console.error(`[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`);
    } else if (level === "warn") {
      console.warn(`[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`);
    } else {
      console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`);
    }
  }
}

module.exports = {
  info: (msg, meta) => log("info", msg, meta),
  warn: (msg, meta) => log("warn", msg, meta),
  error: (msg, meta) => log("error", msg, meta),
  debug: (msg, meta) => log("debug", msg, meta),
  sanitize
};
