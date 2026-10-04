// Giới hạn tần suất đơn giản theo IP (bộ nhớ trong) để tránh lạm dụng chi phí API.
// Với triển khai nhiều máy chủ, hãy thay bằng Redis hoặc giới hạn ở tầng reverse proxy.

export function createRateLimiter({ limit, windowMs }) {
  const hits = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (now - entry.start > windowMs) hits.delete(key);
    }
  }, windowMs).unref();

  return function rateLimit(req, res, next) {
    const key = req.ip || "unknown";
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || now - entry.start > windowMs) {
      entry = { start: now, count: 0 };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > limit) {
      res.setHeader("Retry-After", Math.ceil((entry.start + windowMs - now) / 1000));
      return res.status(429).json({ error: "Bạn gửi yêu cầu quá nhanh. Vui lòng đợi một chút rồi thử lại." });
    }
    next();
  };
}
