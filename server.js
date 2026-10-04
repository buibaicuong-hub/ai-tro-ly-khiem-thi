// Máy chủ backend cho Trợ lý AI khiếm thị.
// - Phục vụ giao diện PWA tĩnh trong thư mục public/
// - Giữ khoá API Anthropic ở phía máy chủ (không bao giờ lộ ra trình duyệt)
// - Chuyển tiếp yêu cầu trò chuyện / mô tả ảnh tới Claude và stream văn bản về (SSE)
//   để trình duyệt đọc to từng câu ngay khi có, giảm độ trễ cho người dùng.

import "dotenv/config";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHAT_SYSTEM_PROMPT, VISION_SYSTEM_PROMPT, DEFAULT_VISION_QUESTION } from "./src/prompts.js";
import { createRateLimiter } from "./src/rate-limit.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 3000;
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const CHAT_EFFORT = process.env.CHAT_EFFORT || "low";
const VISION_EFFORT = process.env.VISION_EFFORT || "medium";
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN) || 20;

const MAX_HISTORY_MESSAGES = 20;
const MAX_TEXT_CHARS = 4000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // giới hạn ảnh của Claude API
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// Đọc thông tin xác thực từ môi trường (ANTHROPIC_API_KEY hoặc hồ sơ `ant auth login`).
const client = new Anthropic();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "8mb" }));

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  // Cho phép camera và micro trên chính trang này.
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(self)");
  next();
});

app.use(
  express.static(path.join(here, "public"), {
    setHeaders(res, filePath) {
      // Service worker phải luôn được tải bản mới nhất.
      if (filePath.endsWith("sw.js")) res.setHeader("Cache-Control", "no-cache");
      if (filePath.endsWith(".webmanifest")) res.setHeader("Content-Type", "application/manifest+json");
    },
  }),
);

const rateLimit = createRateLimiter({ limit: RATE_LIMIT_PER_MIN, windowMs: 60_000 });

app.get("/api/health", (req, res) => {
  res.json({ ok: true, model: MODEL });
});

app.post("/api/chat", rateLimit, async (req, res) => {
  const messages = sanitizeHistory(req.body?.messages);
  if (!messages) {
    return res.status(400).json({ error: "Dữ liệu hội thoại không hợp lệ." });
  }
  await streamClaude(res, {
    system: CHAT_SYSTEM_PROMPT,
    effort: CHAT_EFFORT,
    messages: withClock(messages, req.body?.clientTime),
  });
});

app.post("/api/vision", rateLimit, async (req, res) => {
  const image = parseDataUrl(req.body?.image);
  if (!image) {
    return res.status(400).json({ error: "Ảnh không hợp lệ hoặc quá lớn (tối đa 5 MB)." });
  }
  const question = cleanText(req.body?.question) || DEFAULT_VISION_QUESTION;
  const messages = [
    {
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } },
        { type: "text", text: question },
      ],
    },
  ];
  await streamClaude(res, {
    system: VISION_SYSTEM_PROMPT,
    effort: VISION_EFFORT,
    messages: withClock(messages, req.body?.clientTime),
  });
});

// Mọi đường dẫn khác trả về trang chính (để PWA mở được từ bất kỳ URL nào).
app.use((req, res) => {
  res.sendFile(path.join(here, "public", "index.html"));
});

/**
 * Gọi Claude ở chế độ stream và chuyển tiếp văn bản về trình duyệt dưới dạng
 * Server-Sent Events: `data: {"text": "..."}` cho từng đoạn, `data: {"done": true}` khi xong,
 * `data: {"error": "..."}` khi có lỗi.
 */
async function streamClaude(res, { system, effort, messages }) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    system,
    messages,
    output_config: { effort },
    // Nếu bộ lọc an toàn của mô hình từ chối nhầm, máy chủ Anthropic tự chạy lại
    // trên mô hình dự phòng phù hợp thay vì trả về lời từ chối.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });

  // Người dùng huỷ (bấm dừng / đóng trang) -> ngừng sinh văn bản để tiết kiệm chi phí.
  res.on("close", () => {
    if (!res.writableEnded) stream.abort();
  });

  try {
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        send({ text: event.delta.text });
      }
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") {
      send({ text: " Xin lỗi, tôi không thể hỗ trợ yêu cầu này." });
    } else if (final.stop_reason === "max_tokens") {
      send({ text: " (Câu trả lời đã bị cắt ngắn.)" });
    }
    send({ done: true });
  } catch (error) {
    if (error instanceof Anthropic.APIUserAbortError) return;
    console.error("[claude]", describeError(error));
    send({ error: friendlyError(error) });
  } finally {
    if (!res.writableEnded) res.end();
  }
}

function sanitizeHistory(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const messages = [];
  for (const item of raw.slice(-MAX_HISTORY_MESSAGES)) {
    const role = item?.role;
    const text = cleanText(item?.content);
    if ((role !== "user" && role !== "assistant") || !text) continue;
    // Gộp các lượt liên tiếp cùng vai trò để đảm bảo hội thoại xen kẽ hợp lệ.
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
function withClock(messages, clientTime) {
  const time = cleanText(clientTime)?.slice(0, 100);
  if (!time) return messages;
  return [...messages, { role: "system", content: `Thời gian hiện tại trên thiết bị người dùng: ${time}.` }];
}

function cleanText(value) {
  if (typeof value !== "string") return null;
  const text = value.trim().slice(0, MAX_TEXT_CHARS);
  return text || null;
}

function parseDataUrl(value) {
  if (typeof value !== "string") return null;
  const match = /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match || !ALLOWED_IMAGE_TYPES.has(match[1])) return null;
  const approxBytes = Math.floor((match[2].length * 3) / 4);
  if (approxBytes > MAX_IMAGE_BYTES) return null;
  return { mediaType: match[1], data: match[2] };
}

function friendlyError(error) {
  if (error instanceof Anthropic.AuthenticationError) {
    return "Máy chủ chưa được cấu hình khoá API hợp lệ.";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "Hệ thống đang quá tải. Vui lòng thử lại sau ít phút.";
  }
  if (error instanceof Anthropic.BadRequestError) {
    return "Yêu cầu không hợp lệ. Vui lòng thử lại.";
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "Không kết nối được tới dịch vụ AI. Vui lòng kiểm tra mạng.";
  }
  if (error instanceof Anthropic.APIError) {
    return "Dịch vụ AI đang gặp sự cố. Vui lòng thử lại.";
  }
  return "Đã có lỗi xảy ra. Vui lòng thử lại.";
}

function describeError(error) {
  if (error instanceof Anthropic.APIError) return `${error.status ?? ""} ${error.message}`;
  return error?.stack || String(error);
}

app.listen(PORT, () => {
  console.log(`Trợ lý AI khiếm thị đang chạy tại http://localhost:${PORT} (mô hình: ${MODEL})`);
});
