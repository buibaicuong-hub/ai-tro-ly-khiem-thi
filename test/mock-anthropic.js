// Máy chủ giả lập Claude Messages API (stream) cho kiểm thử, không cần khoá API thật.
import http from "node:http";

export function startMockAnthropic() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const json = JSON.parse(body);
      requests.push({ headers: req.headers, body: json });
      const last = json.messages.at(-1);

      // Kịch bản "NOSEARCH": giả lập API từ chối công cụ tìm kiếm web.
      if (JSON.stringify(json.messages).includes("NOSEARCH") && json.tools) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "tools.0.web_search_20260209: not supported" } }));
        return;
      }
      const text = JSON.stringify(json.messages);
      res.writeHead(200, { "content-type": "text/event-stream" });
      const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: json.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } });

      // Kịch bản "PAUSE": lượt đầu dừng giữa vòng tìm kiếm web (pause_turn), lượt sau trả lời.
      if (text.includes("PAUSE") && last.role !== "assistant") {
        ev("content_block_start", { index: 0, content_block: { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: {} } });
        ev("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: '{"query":"thoi tiet"}' } });
        ev("content_block_stop", { index: 0 });
        ev("message_delta", { delta: { stop_reason: "pause_turn", stop_sequence: null }, usage: { output_tokens: 5 } });
      } else {
        const answer = text.includes('"image"') ? "Trước mặt bạn là bức tường." : "Xin chào. Tôi có thể giúp gì?";
        ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
        for (const part of answer.match(/.{1,8}/gs)) ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: part } });
        ev("content_block_stop", { index: 0 });
        ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } });
      }
      ev("message_stop", {});
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, () => resolve({ server, requests, url: `http://127.0.0.1:${server.address().port}` }));
  });
}
