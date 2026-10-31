/**
 * src/middleware/rateLimit.js — Simple in-memory rate limiter
 * Protects compute-heavy endpoints (upload & simulate) from abuse.
 */

function createRateLimiter({ windowMs = 60000, max = 60, message = 'Too many requests. Please try again shortly.' } = {}) {
  const hits = new Map();

  // Periodic cleanup of expired IP records every 60s
  setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of hits.entries()) {
      if (now > record.resetTime) {
        hits.delete(ip);
      }
    }
  }, windowMs);

  return function rateLimit(req, res, next) {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    let record = hits.get(ip);
    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + windowMs };
      hits.set(ip, record);
    } else {
      record.count += 1;
    }

    if (record.count > max) {
      return res.status(429).json({
        error: message,
        hint: `Rate limit is ${max} requests per minute.`
      });
    }

    next();
  };
}

module.exports = { createRateLimiter };
