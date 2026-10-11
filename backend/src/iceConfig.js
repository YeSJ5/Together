const crypto = require("crypto");

const DEFAULT_STUN_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" }
];

function getIceServerConfig(options = {}) {
  const rawClient = String(options.clientId || "together-peer");
  const clientId = rawClient.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "together-peer";
  const ttlSeconds = Math.min(604800, Math.max(60, Number(options.ttlSeconds) || 86400));

  const stunUrlsEnv = process.env.STUN_URLS;
  const turnUrlsEnv = process.env.TURN_URLS;
  const turnSecret = process.env.TURN_SECRET;
  const turnUsername = process.env.TURN_USERNAME;
  const turnCredential = process.env.TURN_CREDENTIAL;

  const stunServers = stunUrlsEnv
    ? stunUrlsEnv.split(",").map((u) => ({ urls: u.trim() })).filter((s) => s.urls && s.urls.startsWith("stun:"))
    : DEFAULT_STUN_SERVERS;

  const iceServers = [...stunServers];
  let hasTurn = false;
  let turnType = "none";

  if (turnUrlsEnv) {
    const urls = turnUrlsEnv
      .split(",")
      .map((u) => u.trim())
      .filter((u) => u && (u.startsWith("turn:") || u.startsWith("turns:")));

    if (urls.length > 0) {
      if (turnSecret) {
        // RFC 5766 REST API ephemeral credential generation using HMAC-SHA1
        const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
        const username = `${expiry}:${clientId}`;
        const hmac = crypto.createHmac("sha1", turnSecret);
        hmac.update(username);
        const credential = hmac.digest("base64");

        iceServers.push({
          urls,
          username,
          credential
        });
        hasTurn = true;
        turnType = "ephemeral-hmac";
      } else if (turnUsername && turnCredential) {
        // Static credentials
        iceServers.push({
          urls,
          username: turnUsername,
          credential: turnCredential
        });
        hasTurn = true;
        turnType = "static-auth";
      } else {
        // TURN URLs without auth (e.g. internal dev mesh)
        iceServers.push({ urls });
        hasTurn = true;
        turnType = "unauthenticated";
      }
    }
  }

  return {
    iceServers,
    hasTurn,
    turnType,
    ttl: ttlSeconds
  };
}

module.exports = {
  getIceServerConfig,
  DEFAULT_STUN_SERVERS
};
