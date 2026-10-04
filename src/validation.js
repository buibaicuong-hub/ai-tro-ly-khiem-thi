// Kiểm tra và làm sạch dữ liệu từ trình duyệt trước khi gửi tới Claude.

export const MAX_HISTORY_MESSAGES = 20;
export const MAX_TEXT_CHARS = 4000;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // giới hạn ảnh của Claude API
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function cleanText(value) {
  if (typeof value !== "string") return null;
  const text = value.trim().slice(0, MAX_TEXT_CHARS);
  return text || null;
}

/**
 * Chuẩn hoá lịch sử hội thoại: chỉ giữ lượt user/assistant dạng chuỗi, gộp lượt trùng vai trò,
 * bắt đầu bằng user và kết thúc bằng user. Trả về null nếu không hợp lệ.
 */
export function sanitizeHistory(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const messages = [];
  for (const item of raw.slice(-MAX_HISTORY_MESSAGES)) {
    const role = item?.role;
    const text = cleanText(item?.content);
    if ((role !== "user" && role !== "assistant") || !text) continue;
    const last = messages[messages.length - 1];
    if (last && last.role === role) {
      last.content += `\n${text}`;
    } else {
      messages.push({ role, content: text });
    }
  }
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== "user") return null;
  return messages;
}

// Thêm giờ địa phương của người dùng bằng một system message ở cuối hội thoại
// (không sửa system prompt cố định để giữ nguyên bộ nhớ đệm prompt).
export function withClock(messages, clientTime) {
  const time = cleanText(clientTime)?.slice(0, 100);
  if (!time) return messages;
  return [...messages, { role: "system", content: `Thời gian hiện tại trên thiết bị người dùng: ${time}.` }];
}

/** Tách data URL ảnh thành { mediaType, data }; null nếu sai định dạng hoặc quá lớn. */
export function parseDataUrl(value) {
  if (typeof value !== "string") return null;
  const match = /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match || !ALLOWED_IMAGE_TYPES.has(match[1])) return null;
  const approxBytes = Math.floor((match[2].length * 3) / 4);
  if (approxBytes > MAX_IMAGE_BYTES) return null;
  return { mediaType: match[1], data: match[2] };
}
