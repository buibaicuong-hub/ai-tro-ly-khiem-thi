// Gọi API máy chủ và đọc phản hồi dạng luồng (Server-Sent Events qua fetch).

let accessCode = readAccessCode();

/** Lưu mã truy cập do người dùng gõ (ví dụ trong ứng dụng đã cài trên iPhone, nơi bộ nhớ tách biệt với Safari). */
export function setAccessCode(code) {
  accessCode = code;
  try { localStorage.setItem("accessCode", code); } catch { /* bỏ qua */ }
}

/**
 * @param {string} url
 * @param {object} body
 * @param {{signal?: AbortSignal, onText: (chunk: string) => void, onStatus?: (status: string) => void}} opts
 */
export async function streamRequest(url, body, { signal, onText, onStatus }) {
  const headers = { "Content-Type": "application/json" };
  if (accessCode) headers["X-Access-Code"] = accessCode;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...body, clientTime: localTimeString() }),
    signal,
  });

  if (!res.ok) {
    let message = "Máy chủ đang gặp sự cố. Vui lòng thử lại.";
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch { /* phản hồi không phải JSON */ }
    throw new UserFacingError(message, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of raw.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const event = JSON.parse(line.slice(5).trim());
        if (event.error) throw new UserFacingError(event.error);
        if (event.status) onStatus?.(event.status);
        if (event.text) {
          full += event.text;
          onText(event.text);
        }
      }
    }
  }
  return full;
}

export class UserFacingError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

function localTimeString() {
  try {
    return new Date().toLocaleString("vi-VN", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return new Date().toString();
  }
}

// Mã truy cập (nếu máy chủ yêu cầu) được chia sẻ qua đường link dạng https://.../?code=XXXX.
// Lưu lại trên thiết bị rồi xoá khỏi thanh địa chỉ để không lộ khi chia sẻ màn hình.
function readAccessCode() {
  let code = null;
  try {
    const url = new URL(location.href);
    const fromUrl = url.searchParams.get("code");
    if (fromUrl) {
      localStorage.setItem("accessCode", fromUrl);
      url.searchParams.delete("code");
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
    code = fromUrl || localStorage.getItem("accessCode");
  } catch { /* trình duyệt chặn lưu trữ */ }
  return code;
}
