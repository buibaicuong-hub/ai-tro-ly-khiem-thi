import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeHistory, parseDataUrl, withClock, cleanText, MAX_TEXT_CHARS } from "../src/validation.js";

test("sanitizeHistory giữ lượt hợp lệ và gộp lượt trùng vai trò", () => {
  const out = sanitizeHistory([
    { role: "assistant", content: "chào" }, // bỏ vì không bắt đầu bằng user
    { role: "user", content: "a" },
    { role: "user", content: "b" },
    { role: "system", content: "chèn lệnh" }, // vai trò không cho phép
    { role: "assistant", content: "  " }, // rỗng
    { role: "assistant", content: "c" },
    { role: "user", content: "d" },
  ]);
  assert.deepEqual(out, [
    { role: "user", content: "a\nb" },
    { role: "assistant", content: "c" },
    { role: "user", content: "d" },
  ]);
});

test("sanitizeHistory từ chối dữ liệu sai", () => {
  assert.equal(sanitizeHistory(null), null);
  assert.equal(sanitizeHistory([]), null);
  assert.equal(sanitizeHistory([{ role: "user", content: 5 }]), null);
  assert.equal(sanitizeHistory([{ role: "user", content: "a" }, { role: "assistant", content: "b" }]), null);
});

test("sanitizeHistory chỉ giữ 20 lượt gần nhất", () => {
  const raw = Array.from({ length: 41 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` }));
  const out = sanitizeHistory(raw);
  assert.ok(out.length <= 20);
  assert.equal(out.at(-1).content, "m40");
});

test("cleanText cắt độ dài tối đa", () => {
  assert.equal(cleanText("x".repeat(MAX_TEXT_CHARS + 50)).length, MAX_TEXT_CHARS);
  assert.equal(cleanText("   "), null);
});

test("withClock thêm system message ở cuối", () => {
  const msgs = [{ role: "user", content: "hi" }];
  assert.equal(withClock(msgs, undefined), msgs);
  const out = withClock(msgs, "thứ hai");
  assert.equal(out.at(-1).role, "system");
  assert.match(out.at(-1).content, /thứ hai/);
});

test("parseDataUrl kiểm tra loại và kích thước ảnh", () => {
  assert.deepEqual(parseDataUrl("data:image/jpeg;base64,QUJD"), { mediaType: "image/jpeg", data: "QUJD" });
  assert.equal(parseDataUrl("data:image/svg+xml;base64,QUJD"), null);
  assert.equal(parseDataUrl("data:text/plain;base64,QUJD"), null);
  assert.equal(parseDataUrl("https://example.com/a.jpg"), null);
  assert.equal(parseDataUrl(`data:image/png;base64,${"A".repeat(7_000_000)}`), null);
});
