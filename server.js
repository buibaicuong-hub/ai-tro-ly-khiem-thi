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
import { buildChatSystemPrompt, VISION_SYSTEM_PROMPT, DEFAULT_VISION_QUESTION } from "./src/prompts.js";
import { createRateLimiter } from "./src/rate-limit.js";
import { createAccessGuard } from "./src/access.js";
import { cleanText, parseDataUrl, sanitizeHistory, withClock } from "./src/validation.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 3000;
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const CHAT_EFFORT = process.env.CHAT_EFFORT || "low";
const VISION_EFFORT = process.env.VISION_EFFORT || "medium";
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN) || 20;
const WEB_SEARCH = process.env.ENABLE_WEB_SEARCH !== "false";
const ACCESS_CODE = process.env.APP_ACCESS_CODE || "";
const MAX_CONTINUATIONS = 3; // số lần tiếp tục tối đa khi tìm kiếm web bị tạm dừng (pause_turn)

const CHAT_SYSTEM_PROMPT = buildChatSystemPrompt({ webSearch: WEB_SEARCH });
const CHAT_SYSTEM_PROMPT_NO_SEARCH = buildChatSystemPrompt({ webSearch: false });
// Đặt thành true nếu API từ chối công cụ tìm kiếm web (ví dụ tổ chức đã tắt tìm kiếm web
// trong cài đặt Console); từ đó chỉ trò chuyện không tìm kiếm cho tới khi khởi động lại.
let webSearchRejected = false;
const CHAT_TOOLS = WEB_SEARCH
  ? [
      {
        type: "web_search_20260209",
        name: "web_search",
        max_uses: 3,
        // Không khai báo user_location: API không hỗ trợ mã quốc gia VN (trả lỗi 400).
        // Việc ưu tiên nguồn Việt Nam được yêu cầu trong system prompt.
      },
    ]
  : undefined;

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
const accessGuard = createAccessGuard(ACCESS_CODE);

app.get("/api/health", (req, res) => {
  res.json({ ok: true, model: MODEL, webSearch: WEB_SEARCH && !webSearchRejected, accessCodeRequired: Boolean(ACCESS_CODE) });
});

app.post("/api/chat", accessGuard, rateLimit, async (req, res) => {
  const messages = sanitizeHistory(req.body?.messages);
  if (!messages) {
    return res.status(400).json({ error: "Dữ liệu hội thoại không hợp lệ." });
  }
  const useSearch = CHAT_TOOLS && !webSearchRejected;
  await streamClaude(res, {
    system: useSearch ? CHAT_SYSTEM_PROMPT : CHAT_SYSTEM_PROMPT_NO_SEARCH,
    effort: CHAT_EFFORT,
    tools: useSearch ? CHAT_TOOLS : undefined,
    messages: withClock(messages, req.body?.clientTime),
    // Nếu yêu cầu có tìm kiếm web bị từ chối, thử lại một lần không kèm tìm kiếm.
    retryWithoutTools: useSearch
      ? () => {
          webSearchRejected = true;
          return { system: CHAT_SYSTEM_PROMPT_NO_SEARCH, tools: undefined };
        }
      : null,
  });
});

app.post("/api/vision", accessGuard, rateLimit, async (req, res) => {
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

app.use("/api", (req, res) => {
  res.status(404).json({ error: "Không tìm thấy." });
});

// Mọi đường dẫn khác trả về trang chính (để PWA mở được từ bất kỳ URL nào).
app.use((req, res) => {
  res.sendFile(path.join(here, "public", "index.html"));
});

/**
 * Gọi Claude ở chế độ stream và chuyển tiếp về trình duyệt dưới dạng Server-Sent Events:
 * `{"text": "..."}` cho từng đoạn văn bản, `{"status": "searching"}` khi đang tìm kiếm web,
 * `{"done": true}` khi xong, `{"error": "..."}` khi có lỗi.
 */
async function streamClaude(res, { system, effort, tools, messages, retryWithoutTools = null }) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let sentText = false;
  const send = (payload) => {
    if (payload.text) sentText = true;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const state = { stream: null, closed: false };
  // Người dùng huỷ (bấm dừng / đóng trang) -> ngừng sinh văn bản để tiết kiệm chi phí.
  res.on("close", () => {
    state.closed = true;
    if (!res.writableEnded) state.stream?.abort();
  });

  try {
    try {
      await runConversation({ system, effort, tools, messages }, send, state);
    } catch (error) {
      if (!(error instanceof Anthropic.BadRequestError) || !retryWithoutTools || sentText || state.closed) throw error;
      console.warn("[claude] Yêu cầu có tìm kiếm web bị từ chối, thử lại không tìm kiếm:", describeError(error));
      await runConversation({ effort, messages, ...retryWithoutTools() }, send, state);
    }
    send({ done: true });
  } catch (error) {
    if (error instanceof Anthropic.APIUserAbortError || state.closed) return;
    console.error("[claude]", describeError(error));
    send({ error: friendlyError(error) });
  } finally {
    if (!res.writableEnded) res.end();
  }
}

// Một lượt trả lời, kể cả các lần tiếp tục khi tìm kiếm web bị tạm dừng (pause_turn).
async function runConversation({ system, effort, tools, messages }, send, state) {
  let conversation = messages;
  for (let attempt = 0; attempt <= MAX_CONTINUATIONS && !state.closed; attempt++) {
    state.stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      system,
      messages: conversation,
      ...(tools ? { tools } : {}),
      output_config: { effort },
      // Nếu bộ lọc an toàn của mô hình từ chối nhầm, máy chủ Anthropic tự chạy lại
      // trên mô hình dự phòng phù hợp thay vì trả về lời từ chối.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    for await (const event of state.stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        send({ text: event.delta.text });
      } else if (event.type === "content_block_start" && event.content_block.type === "server_tool_use") {
        send({ status: "searching" });
      }
    }

    const final = await state.stream.finalMessage();
    if (final.stop_reason === "pause_turn") {
      // Vòng tìm kiếm phía máy chủ bị tạm dừng: gửi lại nguyên lượt trả lời để Claude làm tiếp.
      conversation = [...conversation, { role: "assistant", content: final.content }];
      continue;
    }
    if (final.stop_reason === "refusal") {
      send({ text: " Xin lỗi, tôi không thể hỗ trợ yêu cầu này." });
    } else if (final.stop_reason === "max_tokens") {
      send({ text: " (Câu trả lời đã bị cắt ngắn.)" });
    }
    return;
  }
}

function friendlyError(error) {
  if (error instanceof Anthropic.AuthenticationError) {
    return "Máy chủ chưa được cấu hình khoá API hợp lệ.";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "Hệ thống đang quá tải. Vui lòng thử lại sau ít phút.";
  }
  if (error instanceof Anthropic.BadRequestError) {
    return "Dịch vụ AI từ chối yêu cầu. Người quản trị hãy xem dòng bắt đầu bằng [claude] trong nhật ký máy chủ.";
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
  console.log(`Tìm kiếm web: ${WEB_SEARCH ? "bật" : "tắt"} · Mã truy cập: ${ACCESS_CODE ? "bật" : "tắt"}`);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.warn("Cảnh báo: chưa đặt ANTHROPIC_API_KEY trong .env — các yêu cầu tới AI sẽ thất bại.");
  }
});
