// Small in-memory rate limiter for sensitive endpoints such as login.
// Suitable for a single backend process. Use a shared store if the API is scaled out.
//
// Options:
//   keyGenerator(req)  - what to count by (default: client IP)
//   failuresOnly       - only count responses with status >= 400, so normal sign-ins
//                        by many users behind one proxy/IP never lock each other out
export const rateLimit = ({ windowMs, max, message, keyGenerator = (req) => req.ip || "unknown", failuresOnly = false }) => {
  const hits = new Map();

  const add = (key, now) => {
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) hits.set(key, { count: 1, resetAt: now + windowMs });
    else entry.count += 1;
  };

  return (req, res, next) => {
    const now = Date.now();
    const key = keyGenerator(req);
    const entry = hits.get(key);

    if (entry && entry.resetAt > now && entry.count >= max) {
      res.set("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ message });
    }

    if (failuresOnly) {
      res.on("finish", () => {
        if (res.statusCode >= 400) add(key, Date.now());
      });
    } else {
      add(key, now);
    }

    if (hits.size > 10000) {
      for (const [storedKey, value] of hits) {
        if (value.resetAt <= now) hits.delete(storedKey);
      }
    }

    return next();
  };
};
