const ipRequests = new Map();

function createRateLimiter({
  windowMs = 60000,
  maxRequests = 60,
  message = "Too many requests. Please slow down and try again later."
} = {}) {
  return (req, res, next) => {
    // In automated tests or local development with loopback, don't throttle unless specified
    if (process.env.NODE_ENV === "test" && !req.headers["x-test-ratelimit"]) {
      return next();
    }

    const ip =
      req.ip ||
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      "anonymous";

    const key = `${req.baseUrl || ""}${req.path}:${ip}`;
    const now = Date.now();

    let entry = ipRequests.get(key);
    if (!entry || now - entry.startTime > windowMs) {
      entry = { count: 1, startTime: now };
      ipRequests.set(key, entry);
    } else {
      entry.count += 1;
    }

    const remaining = Math.max(0, maxRequests - entry.count);
    res.setHeader("X-RateLimit-Limit", maxRequests);
    res.setHeader("X-RateLimit-Remaining", remaining);

    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((windowMs - (now - entry.startTime)) / 1000);
      res.setHeader("Retry-After", retryAfter);
      return res.status(429).json({
        message,
        retryAfterSeconds: retryAfter
      });
    }

    next();
  };
}

// Maintenance cleanup
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of ipRequests.entries()) {
    if (now - entry.startTime > 300000) {
      ipRequests.delete(key);
    }
  }
}, 60000).unref();

module.exports = {
  createRateLimiter
};
