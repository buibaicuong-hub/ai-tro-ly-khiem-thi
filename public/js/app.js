// Điều phối chính của Trợ lý Sáng Mắt.
// Trạng thái: idle -> listening -> thinking -> speaking -> idle
//             idle -> capturing (Mắt thần) -> thinking -> speaking -> idle

import { Speaker, Listener } from "./speech.js";
import { Camera, fileToDataUrl } from "./camera.js";
import { streamRequest, UserFacingError } from "./api.js";
import { sounds, unlockAudio } from "./sounds.js";

const LONG_PRESS_MS = 700;
const MAX_HISTORY = 20;

const HELP_TEXT =
  "Hướng dẫn sử dụng. Chạm vào bất kỳ đâu trên màn hình rồi nói câu hỏi của bạn; chạm lần nữa để dừng nghe. " +
  "Khi trợ lý đang đọc, chạm để ngắt lời và nói tiếp. " +
  "Để dùng Mắt thần, hãy giữ ngón tay trên màn hình khoảng một giây, hoặc nói: chụp ảnh, trước mặt có gì, đọc chữ giúp tôi. " +
  "Hướng camera sau của điện thoại về phía cần xem, giữ cao ngang ngực. " +
  "Các lệnh khác: nhắc lại, nói chậm hơn, nói nhanh hơn, cuộc trò chuyện mới, và trợ giúp. " +
  "Trên máy tính: phím Cách để nói hoặc dừng, phím C để chụp ảnh, phím R để nhắc lại, phím Esc để dừng, phím H để nghe hướng dẫn này.";

const WELCOME_TEXT =
  "Xin chào, tôi là Trợ lý Sáng Mắt. Chạm vào màn hình để hỏi tôi bất cứ điều gì, hoặc giữ ngón tay khoảng một giây để tôi nhìn giúp bạn qua camera. " +
  "Nói trợ giúp để nghe hướng dẫn đầy đủ.";

/* ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);
const els = {
  status: $("status"),
  talk: $("talk"),
  label: $("talk-label"),
  userText: $("user-text"),
  assistantText: $("assistant-text"),
  form: $("text-form"),
  input: $("text-input"),
  cameraBtn: $("camera-btn"),
  fileInput: $("file-input"),
  video: $("camera-preview"),
};

const speaker = new Speaker();
const listener = new Listener();
const camera = new Camera(els.video);

const store = safeStorage();
let state = "idle";
let history = loadHistory();
let lastAnswer = "";
let currentRequest = null; // AbortController của yêu cầu đang chạy
let unlocked = false;

speaker.rate = Number(store.get("rate")) || 1;
speaker.onIdle = () => {
  if (state === "speaking") setState("idle");
};

// Nếu không có giọng đọc, để trình đọc màn hình đọc câu trả lời thay thế.
if (!speaker.supported) els.assistantText.setAttribute("aria-live", "polite");

/* ------------------------------------------------------------------ */
/* Trạng thái giao diện                                                */
/* ------------------------------------------------------------------ */

const LABELS = {
  idle: "Chạm để nói",
  listening: "Đang nghe… Chạm để dừng",
  thinking: "Đang suy nghĩ…",
  capturing: "Đang chụp ảnh…",
  speaking: "Đang đọc… Chạm để ngắt",
  error: "Chạm để thử lại",
};

function setState(next, statusText) {
  state = next;
  document.body.dataset.state = next;
  els.label.textContent = LABELS[next];
  els.talk.setAttribute("aria-label", LABELS[next]);
  if (statusText !== undefined) setStatus(statusText);
  else if (next === "idle") setStatus(readyStatus());
}

function setStatus(text) {
  els.status.textContent = text;
}

function readyStatus() {
  if (speaker.supported && !speaker.hasVietnameseVoice) {
    return "Sẵn sàng. Lưu ý: thiết bị chưa có giọng đọc tiếng Việt.";
  }
  return "Sẵn sàng. Chạm vào màn hình để nói.";
}

/* ------------------------------------------------------------------ */
/* Hành động chính                                                     */
/* ------------------------------------------------------------------ */

function unlockOnce() {
  if (unlocked) return false;
  unlocked = true;
  unlockAudio();
  speaker.unlock();
  if (!store.get("welcomed")) {
    store.set("welcomed", "1");
    speak(WELCOME_TEXT);
    return true;
  }
  return false;
}

// Một thao tác chạm / phím Cách: hành động phụ thuộc trạng thái hiện tại.
function toggle() {
  if (unlockOnce()) return;
  switch (state) {
    case "listening":
      listener.stop();
      break;
    case "thinking":
    case "capturing":
      cancelAll();
      speak("Đã huỷ.");
      break;
    case "speaking":
      speaker.stop();
      startListening();
      break;
    default:
      startListening();
  }
}

async function startListening() {
  speaker.stop();
  if (!listener.supported) {
    setState("idle", "Trình duyệt không hỗ trợ nhận diện giọng nói. Hãy gõ câu hỏi ở ô phía dưới.");
    speak("Trình duyệt này chưa hỗ trợ nhận diện giọng nói. Bạn hãy gõ câu hỏi, hoặc dùng nút micro trên bàn phím để đọc chính tả. Trên điện thoại, nên dùng trình duyệt Chrome hoặc Safari.");
    els.input.focus();
    return;
  }

  setState("listening", "Đang nghe… Hãy nói câu hỏi của bạn.");
  sounds.listenStart();
  els.userText.textContent = "";

  let text = "";
  try {
    text = await listener.listen({
      onInterim: (t) => { els.userText.textContent = t; },
    });
  } catch (err) {
    sounds.error();
    const msg = err.message === "not-allowed" || err.message === "service-not-allowed"
      ? "Ứng dụng chưa được cấp quyền dùng micro. Hãy cho phép micro trong cài đặt trình duyệt rồi thử lại."
      : err.message === "network"
        ? "Nhận diện giọng nói cần kết nối mạng. Hãy kiểm tra mạng rồi thử lại."
        : "Không nghe được giọng nói. Hãy chạm để thử lại.";
    setState("error", msg);
    speak(msg);
    return;
  }

  if (state !== "listening") return; // đã bị huỷ
  sounds.listenStop();

  if (!text) {
    setState("idle", "Chưa nghe rõ. Chạm để nói lại.");
    speak("Tôi chưa nghe rõ. Chạm để nói lại.");
    return;
  }
  els.userText.textContent = text;
  handleUtterance(text);
}

// Định tuyến lệnh giọng nói nội bộ trước khi hỏi AI.
function handleUtterance(text) {
  const plain = normalize(text);
  const short = plain.split(" ").length <= 6;

  if (short && /\b(tro giup|huong dan su dung|cach su dung)\b/.test(plain)) {
    return speak(HELP_TEXT);
  }
  if (/^(dung|dung lai|im lang|im di|thoi|huy|huy bo)$/.test(plain)) {
    cancelAll();
    return setState("idle");
  }
  if (short && /\b(nhac lai|lap lai|noi lai)\b/.test(plain)) {
    return repeatLast();
  }
  if (short && /\bnoi cham\b/.test(plain)) {
    return changeRate(-0.15);
  }
  if (short && /\bnoi nhanh\b/.test(plain)) {
    return changeRate(+0.15);
  }
  if (short && /\b(cuoc tro chuyen moi|xoa lich su|bat dau lai)\b/.test(plain)) {
    history = [];
    saveHistory();
    return speak("Đã bắt đầu cuộc trò chuyện mới.");
  }
  if (VISION_PATTERN.test(plain)) {
    const isBareCommand = short && /^(hay |vui long )?(chup( anh| hinh)?|mat than|mo camera)( giup( toi)?)?$/.test(plain);
    return describeScene(isBareCommand ? "" : text);
  }
  return ask(text);
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
      "day la (cai|thu )?gi",
    ].join("|") +
  ")\\b",
);

async function ask(text) {
  pushHistory("user", text);
  await runStream("/api/chat", { messages: history }, (answer) => pushHistory("assistant", answer));
}

async function describeScene(question) {
  if (unlockOnce()) return;
  cancelAll();
  setState("capturing", "Đang mở camera…");

  let image;
  try {
    if (!camera.supported) throw new Error("unsupported");
    image = await camera.capture();
  } catch (err) {
    camera.close();
    if (err?.name === "NotAllowedError") {
      sounds.error();
      setState("error", "Chưa có quyền dùng camera.");
      return speak("Ứng dụng chưa được cấp quyền dùng camera. Hãy cho phép camera trong cài đặt trình duyệt, hoặc bấm nút Mắt thần ở cuối màn hình để chọn ảnh.");
    }
    // Dự phòng: mở ứng dụng chụp ảnh của hệ thống.
    pendingVisionQuestion = question;
    setState("idle", "Hãy chụp ảnh bằng ứng dụng camera.");
    els.fileInput.click();
    return;
  }
  if (state !== "capturing") return; // người dùng đã huỷ trong lúc chụp
  sounds.shutter();
  await sendVision(image, question);
}

let pendingVisionQuestion = "";

async function sendVision(image, question) {
  const label = question ? `[Ảnh từ camera] ${question}` : "[Ảnh từ camera] Mô tả những gì trước mặt tôi.";
  els.userText.textContent = label;
  await runStream("/api/vision", { image, question }, (answer) => {
    // Lưu mô tả vào lịch sử để người dùng hỏi tiếp bằng giọng nói.
    pushHistory("user", label);
    pushHistory("assistant", answer);
  });
}

// Gửi yêu cầu, đọc to từng câu ngay khi nhận được.
async function runStream(url, body, onComplete) {
  cancelRequest();
  const controller = new AbortController();
  currentRequest = controller;

  setState("thinking", "Đang suy nghĩ…");
  sounds.thinking();
  els.assistantText.textContent = "";
  speaker.stop();
  speaker.beginStream();

  try {
    const answer = await streamRequest(url, body, {
      signal: controller.signal,
      onText(chunk) {
        if (state === "thinking") setState("speaking", "Đang trả lời…");
        els.assistantText.textContent += chunk;
        speaker.push(chunk);
      },
    });
    if (controller.signal.aborted) return;
    lastAnswer = answer;
    onComplete?.(answer);
    if (state === "thinking") setState("speaking", "Đang trả lời…");
    if (!speaker.supported) setState("idle");
    speaker.endStream();
  } catch (err) {
    if (controller.signal.aborted || err?.name === "AbortError") return;
    speaker.stop();
    sounds.error();
    const msg = err instanceof UserFacingError
      ? err.message
      : navigator.onLine === false
        ? "Không có kết nối mạng. Hãy kiểm tra mạng rồi thử lại."
        : "Đã có lỗi khi kết nối máy chủ. Hãy thử lại.";
    setState("error", msg);
    speak(msg);
  } finally {
    if (currentRequest === controller) currentRequest = null;
  }
}

function speak(text) {
  els.assistantText.textContent = text;
  if (!speaker.supported) return setState("idle");
  setState("speaking", state === "error" ? els.status.textContent : "Đang đọc…");
  speaker.say(text);
}

function repeatLast() {
  if (!lastAnswer) return speak("Chưa có câu trả lời nào để nhắc lại.");
  speak(lastAnswer);
}

function changeRate(delta) {
  speaker.rate = Math.min(1.8, Math.max(0.6, Math.round((speaker.rate + delta) * 100) / 100));
  store.set("rate", String(speaker.rate));
  speak(delta < 0 ? "Đã giảm tốc độ đọc." : "Đã tăng tốc độ đọc.");
}

function cancelRequest() {
  if (currentRequest) {
    currentRequest.abort();
    currentRequest = null;
  }
}

function cancelAll() {
  cancelRequest();
  listener.abort();
  speaker.stop();
  if (state === "listening") sounds.listenStop();
  setState("idle");
}

/* ------------------------------------------------------------------ */
/* Lịch sử hội thoại (chỉ lưu trong phiên trình duyệt)                 */
/* ------------------------------------------------------------------ */

function pushHistory(role, content) {
  history.push({ role, content });
  if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
  saveHistory();
}

function loadHistory() {
  try {
    const data = JSON.parse(sessionStorage.getItem("history") || "[]");
    return Array.isArray(data) ? data.slice(-MAX_HISTORY) : [];
  } catch {
    return [];
  }
}

function saveHistory() {
  try { sessionStorage.setItem("history", JSON.stringify(history)); } catch { /* bỏ qua */ }
}

/* ------------------------------------------------------------------ */
/* Sự kiện: chạm, giữ lâu, bàn phím, biểu mẫu                          */
/* ------------------------------------------------------------------ */

const isExcluded = (target) => target.closest?.("#text-form, .skip-link, input, a");

let pressTimer = null;
let longPressFired = false;
let lastSpaceAt = 0;

document.addEventListener("pointerdown", (e) => {
  if (isExcluded(e.target) || e.button > 0) return;
  longPressFired = false;
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => {
    longPressFired = true;
    describeScene("");
  }, LONG_PRESS_MS);
});

for (const type of ["pointerup", "pointercancel", "pointermove"]) {
  document.addEventListener(type, (e) => {
    // Bỏ qua dịch chuyển rất nhỏ của ngón tay khi đang giữ.
    if (type === "pointermove" && Math.hypot(e.movementX || 0, e.movementY || 0) < 12) return;
    clearTimeout(pressTimer);
  });
}

// Chạm vào bất kỳ đâu (ngoài ô nhập liệu) = bật/tắt micro.
document.addEventListener("click", (e) => {
  if (isExcluded(e.target)) return;
  if (longPressFired) {
    longPressFired = false;
    return;
  }
  // Nút được "bấm" bằng phím Cách đã xử lý ở keydown.
  if (e.detail === 0 && Date.now() - lastSpaceAt < 500) return;
  toggle();
});

document.addEventListener("contextmenu", (e) => {
  if (!isExcluded(e.target)) e.preventDefault();
});

document.addEventListener("keydown", (e) => {
  const typing = e.target.closest?.("input, textarea, [contenteditable]");
  if (e.key === "Escape") {
    cancelAll();
    if (typing) e.target.blur();
    return;
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;

  switch (e.code) {
    case "Space":
      e.preventDefault();
      lastSpaceAt = Date.now();
      if (!e.repeat) toggle();
      break;
    case "KeyC":
      e.preventDefault();
      describeScene("");
      break;
    case "KeyH":
      e.preventDefault();
      unlockOnce();
      speak(HELP_TEXT);
      break;
    case "KeyR":
      e.preventDefault();
      unlockOnce();
      repeatLast();
      break;
  }
});

document.addEventListener("keyup", (e) => {
  if (e.code === "Space" && !e.target.closest?.("input, textarea")) e.preventDefault();
});

els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  unlockOnce();
  const text = els.input.value.trim();
  if (!text) return;
  els.input.value = "";
  cancelAll();
  els.userText.textContent = text;
  handleUtterance(text);
});

els.cameraBtn.addEventListener("click", () => {
  unlocked = true;
  unlockAudio();
  speaker.unlock();
  describeScene(els.input.value.trim());
  els.input.value = "";
});

els.fileInput.addEventListener("change", async () => {
  const file = els.fileInput.files?.[0];
  els.fileInput.value = "";
  if (!file) return;
  try {
    const image = await fileToDataUrl(file);
    sounds.shutter();
    await sendVision(image, pendingVisionQuestion);
  } catch {
    sounds.error();
    setState("error", "Không đọc được ảnh.");
    speak("Không đọc được ảnh. Hãy thử chụp lại.");
  } finally {
    pendingVisionQuestion = "";
  }
});

// Ẩn ứng dụng (chuyển tab, khoá màn hình) -> tắt camera và micro.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    camera.close();
    if (state === "listening") cancelAll();
  }
});

/* ------------------------------------------------------------------ */
/* Tiện ích                                                            */
/* ------------------------------------------------------------------ */

// Chữ thường, bỏ dấu tiếng Việt để so khớp lệnh ổn định hơn.
function normalize(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeStorage() {
  return {
    get(key) {
      try { return localStorage.getItem(key); } catch { return null; }
    },
    set(key, value) {
      try { localStorage.setItem(key, value); } catch { /* bỏ qua */ }
    },
  };
}

/* ------------------------------------------------------------------ */
/* Khởi động                                                           */
/* ------------------------------------------------------------------ */

setState("idle");
if (!listener.supported) {
  setStatus("Trình duyệt chưa hỗ trợ nhận diện giọng nói — hãy gõ câu hỏi ở ô phía dưới.");
}
// Danh sách giọng có thể tải chậm: cập nhật lại thông báo khi có.
window.speechSynthesis?.addEventListener?.("voiceschanged", () => {
  if (state === "idle" && listener.supported) setStatus(readyStatus());
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
