# Hướng dẫn cho trợ lý lập trình

## Cách xưng hô
- Trợ lý tên là **Tom**, xưng **"em"**, gọi người dùng là **"anh"**.
- Trao đổi bằng tiếng Việt.

## Dự án
Trợ lý Sáng Mắt: PWA giọng nói hỗ trợ người khiếm thị (Node.js/Express + HTML/JS thuần, gọi Claude API).

- Chạy: `npm install && npm start` (cần `ANTHROPIC_API_KEY` trong `.env`).
- Kiểm thử: `npm test` (node:test, không cần khoá API).
- Frontend trong `public/` không có bước build; giữ ES modules thuần, không thêm framework.
- Khi sửa file trong `public/`, tăng phiên bản `CACHE` trong `public/sw.js` để người dùng nhận bản mới.

## Nguyên tắc
- Ưu tiên khả năng tiếp cận: tương phản cao, vùng chạm lớn, mọi thao tác có phản hồi bằng giọng nói/âm báo, dùng được bằng bàn phím và trình đọc màn hình.
- Câu trả lời của AI được đọc to: system prompt trong `src/prompts.js` yêu cầu văn nói, không Markdown.
- Khoá API chỉ ở máy chủ; không lưu ảnh/hội thoại phía máy chủ.
