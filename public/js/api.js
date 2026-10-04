// Gọi API máy chủ và đọc phản hồi dạng luồng (Server-Sent Events qua fetch).

/**
 * @param {string} url
 * @param {object} body
 * @param {{signal?: AbortSignal, onText: (chunk: string) => void}} opts
 */
export async function streamRequest(url, body, { signal, onText }) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, clientTime: localTimeString() }),
    signal,
  });

  if (!res.ok) {
    let message = "Máy chủ đang gặp sự cố. Vui lòng thử lại.";
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch { /* phản hồi không phải JSON */ }
    throw new UserFacingError(message);
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
        if (event.text) {
          full += event.text;
          onText(event.text);
        }
      }
    }
  }
  return full;
}

export class UserFacingError extends Error {}

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
