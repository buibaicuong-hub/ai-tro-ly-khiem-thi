// Mã truy cập tuỳ chọn (APP_ACCESS_CODE) để chỉ người được chia sẻ đường link mới dùng được API,
// tránh người lạ làm phát sinh chi phí. Mã được gửi qua header X-Access-Code.

import { timingSafeEqual } from "node:crypto";

export function createAccessGuard(code) {
  const expected = code ? Buffer.from(code) : null;

  return function accessGuard(req, res, next) {
    if (!expected) return next();
    const given = Buffer.from(String(req.get("x-access-code") || ""));
    if (given.length === expected.length && timingSafeEqual(given, expected)) return next();
    res.status(401).json({ error: "Cần mã truy cập hợp lệ. Hãy mở ứng dụng bằng đường link có kèm mã được chia sẻ cho bạn." });
  };
}
