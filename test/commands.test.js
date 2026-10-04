import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommand, normalize } from "../public/js/commands.js";

const type = (text, ctx) => parseCommand(text, ctx).type;

test("normalize bỏ dấu và ký hiệu", () => {
  assert.equal(normalize("Đọc  chữ giúp TÔI!"), "doc chu giup toi");
});

test("lệnh điều khiển", () => {
  assert.equal(type("Trợ giúp"), "help");
  assert.equal(type("dừng lại"), "stop");
  assert.equal(type("Nhắc lại đi"), "repeat");
  assert.equal(type("nói chậm hơn"), "slower");
  assert.equal(type("nói nhanh hơn một chút"), "faster");
  assert.equal(type("cuộc trò chuyện mới"), "reset");
});

test("không nhầm câu hỏi thường thành lệnh", () => {
  assert.equal(type("dùng điện thoại thế nào"), "ask");
  assert.equal(type("thủ đô Việt Nam là gì"), "ask");
  assert.equal(type("thời tiết Hà Nội hôm nay"), "ask");
  assert.equal(type("đồng ý"), "ask"); // chỉ là lệnh khi đang chờ đồng ý
});

test("lệnh Mắt thần", () => {
  assert.deepEqual(parseCommand("chụp ảnh"), { type: "vision", question: "" });
  assert.deepEqual(parseCommand("Mắt thần"), { type: "vision", question: "" });
  const q = "đọc chữ trên hộp thuốc này giúp tôi";
  assert.deepEqual(parseCommand(q), { type: "vision", question: q });
  assert.equal(type("trước mặt tôi có gì"), "vision");
  assert.equal(type("tờ tiền này bao nhiêu"), "vision");
  assert.equal(type("áo này màu gì"), "vision");
});

test("đồng ý dùng camera", () => {
  assert.equal(type("đồng ý", { consentPending: true }), "consent");
  assert.equal(type("tôi đồng ý", { consentPending: true }), "consent");
});
