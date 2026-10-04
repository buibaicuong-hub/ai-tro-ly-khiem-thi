import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startMockAnthropic } from "./mock-anthropic.js";

const root = fileURLToPath(new URL("..", import.meta.url));
let mock;
const servers = [];

async function startApp(env = {}) {
  const port = 3500 + Math.floor(Math.random() * 400);
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: { ...process.env, ANTHROPIC_API_KEY: "test", ANTHROPIC_BASE_URL: mock.url, PORT: String(port), ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  servers.push(child);
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => d.toString().includes("đang chạy") && resolve());
    child.on("exit", (code) => reject(new Error(`server exited ${code}`)));
  });
  return `http://127.0.0.1:${port}`;
}

async function readSse(res) {
  const events = [];
  for (const block of (await res.text()).split("\n\n")) {
    if (block.startsWith("data:")) events.push(JSON.parse(block.slice(5)));
  }
  return events;
}

const post = (base, path, body, headers = {}) =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

let base;
before(async () => {
  mock = await startMockAnthropic();
  base = await startApp();
});
after(() => {
  servers.forEach((s) => s.kill());
  mock.server.close();
});

test("trang chính, manifest và service worker được phục vụ", async () => {
  assert.equal((await fetch(base + "/")).status, 200);
  const manifest = await (await fetch(base + "/manifest.webmanifest")).json();
  assert.equal(manifest.display, "standalone");
  assert.equal((await fetch(base + "/sw.js")).headers.get("cache-control"), "no-cache");
  assert.equal((await fetch(base + "/api/khong-co")).status, 404);
});

test("/api/chat stream văn bản và gửi đúng tham số tới Claude", async () => {
  mock.requests.length = 0;
  const res = await post(base, "/api/chat", { messages: [{ role: "user", content: "xin chào" }], clientTime: "8 giờ sáng" });
  const events = await readSse(res);
  assert.equal(events.filter((e) => e.text).map((e) => e.text).join(""), "Xin chào. Tôi có thể giúp gì?");
  assert.deepEqual(events.at(-1), { done: true });

  const { body, headers } = mock.requests[0];
  assert.equal(body.model, "claude-opus-5-5");
  assert.equal(body.stream, true);
  assert.equal(body.fallbacks, "default");
  assert.match(headers["anthropic-beta"], /server-side-fallback-2026-07-01/);
  assert.equal(body.tools[0].type, "web_search_20260209");
  assert.equal(body.tools[0].user_location, undefined); // API không hỗ trợ mã quốc gia VN
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].role, "user");
  assert.match(body.messages[0].content.at(-1).text, /8 giờ sáng/);
});

test("/api/chat tiếp tục khi tìm kiếm web bị tạm dừng (pause_turn)", async () => {
  mock.requests.length = 0;
  const events = await readSse(await post(base, "/api/chat", { messages: [{ role: "user", content: "PAUSE thời tiết" }] }));
  assert.ok(events.some((e) => e.status === "searching"));
  assert.equal(events.filter((e) => e.text).map((e) => e.text).join(""), "Xin chào. Tôi có thể giúp gì?");
  assert.equal(mock.requests.length, 2);
  const second = mock.requests[1].body.messages;
  assert.equal(second.at(-1).role, "assistant");
  assert.equal(second.at(-1).content[0].type, "server_tool_use");
});

test("/api/chat thử lại không tìm kiếm web khi API từ chối công cụ", async () => {
  const app = await startApp();
  mock.requests.length = 0;
  const events = await readSse(await post(app, "/api/chat", { messages: [{ role: "user", content: "NOSEARCH xin chào" }] }));
  assert.equal(events.filter((e) => e.text).map((e) => e.text).join(""), "Xin chào. Tôi có thể giúp gì?");
  assert.deepEqual(events.at(-1), { done: true });
  assert.equal(mock.requests.length, 2);
  assert.ok(mock.requests[0].body.tools);
  assert.equal(mock.requests[1].body.tools, undefined);
  assert.match(mock.requests[1].body.system, /không truy cập được Internet/);

  // Các yêu cầu sau bỏ qua tìm kiếm luôn, không phải thử hai lần.
  mock.requests.length = 0;
  await (await post(app, "/api/chat", { messages: [{ role: "user", content: "chào" }] })).text();
  assert.equal(mock.requests.length, 1);
  assert.equal(mock.requests[0].body.tools, undefined);
  assert.equal((await (await fetch(app + "/api/health")).json()).webSearch, false);
});

test("/api/chat từ chối lịch sử không hợp lệ", async () => {
  assert.equal((await post(base, "/api/chat", { messages: [] })).status, 400);
});

test("/api/vision gửi ảnh và từ chối ảnh sai định dạng", async () => {
  mock.requests.length = 0;
  const ok = await post(base, "/api/vision", { image: "data:image/jpeg;base64,QUJD" });
  const events = await readSse(ok);
  assert.match(events.map((e) => e.text || "").join(""), /bức tường/);
  const content = mock.requests[0].body.messages[0].content;
  assert.equal(content[0].type, "image");
  assert.equal(content[1].text, "Hãy mô tả những gì đang ở trước mặt tôi.");
  assert.equal(mock.requests[0].body.tools, undefined);

  assert.equal((await post(base, "/api/vision", { image: "data:text/html;base64,QUJD" })).status, 400);
});

test("mã truy cập và tắt tìm kiếm web", async () => {
  const guarded = await startApp({ APP_ACCESS_CODE: "bimat", ENABLE_WEB_SEARCH: "false" });
  const body = { messages: [{ role: "user", content: "chào" }] };
  assert.equal((await post(guarded, "/api/chat", body)).status, 401);
  assert.equal((await post(guarded, "/api/chat", body, { "x-access-code": "sai" })).status, 401);
  mock.requests.length = 0;
  const res = await post(guarded, "/api/chat", body, { "x-access-code": "bimat" });
  assert.equal(res.status, 200);
  await res.text();
  assert.equal(mock.requests[0].body.tools, undefined);
  const health = await (await fetch(guarded + "/api/health")).json();
  assert.equal(health.accessCodeRequired, true);
  assert.equal(health.webSearch, false);
});
