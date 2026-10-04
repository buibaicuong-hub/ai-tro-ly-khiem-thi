// Nhận dạng lệnh giọng nói xử lý ngay trên máy (không cần gọi AI).
// Tách riêng để kiểm thử được bằng Node (xem test/commands.test.js).

// Chữ thường, bỏ dấu tiếng Việt để so khớp lệnh ổn định hơn.
export function normalize(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const VISION_PATTERN = new RegExp(
  "\\b(" +
    [
      "chup( anh| hinh)?",
      "mat than",
      "mo camera",
      "truoc mat",
      "xung quanh .*co gi",
      "nhin (giup|ho)",
      "xem (giup|ho)",
      "doc (giup |ho )?(chu|nhan|bien|to|hoa don|thuoc|bao bi|cai nay)",
      "to tien",
      "bao nhieu tien",
      "menh gia",
      "mau gi",
      "(cai|thu) nay la (cai )?gi",
      "day la (cai |thu )?gi",
    ].join("|") +
  ")\\b",
);

const BARE_VISION = /^(hay |vui long )?(chup( anh| hinh)?|mat than|mo camera)( giup( toi)?)?$/;

/**
 * @param {string} text câu người dùng nói hoặc gõ
 * @param {{consentPending?: boolean}} [context]
 * @returns {{type: "help"|"stop"|"repeat"|"slower"|"faster"|"reset"|"consent"|"vision"|"ask", question?: string}}
 */
export function parseCommand(text, { consentPending = false } = {}) {
  const plain = normalize(text);
  const short = plain.split(" ").length <= 6;

  if (consentPending && /^(toi )?(dong y|chap nhan|co|ok|oke|duoc)( roi)?$/.test(plain)) {
    return { type: "consent" };
  }
  if (short && /\b(tro giup|huong dan su dung|cach su dung)\b/.test(plain)) return { type: "help" };
  if (/^(dung|dung lai|im lang|im di|thoi|huy|huy bo)$/.test(plain)) return { type: "stop" };
  if (short && /\b(nhac lai|lap lai|noi lai)\b/.test(plain)) return { type: "repeat" };
  if (short && /\bnoi cham\b/.test(plain)) return { type: "slower" };
  if (short && /\bnoi nhanh\b/.test(plain)) return { type: "faster" };
  if (short && /\b(cuoc tro chuyen moi|xoa lich su|bat dau lai)\b/.test(plain)) return { type: "reset" };
  if (VISION_PATTERN.test(plain)) {
    return { type: "vision", question: short && BARE_VISION.test(plain) ? "" : text };
  }
  return { type: "ask" };
}
