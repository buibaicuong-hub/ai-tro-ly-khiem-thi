# Trợ lý Sáng Mắt — Trợ lý AI giọng nói cho người khiếm thị

Ứng dụng web **Voice-First** (ưu tiên giọng nói), cài được như ứng dụng (PWA) trên iPhone/Android và chạy trên trình duyệt máy tính. Người dùng nói câu hỏi bằng tiếng Việt, trợ lý trả lời bằng giọng nói; chức năng **Mắt thần** chụp ảnh từ camera và đọc to mô tả những gì ở trước mặt.

## Tính năng

| Tính năng | Mô tả |
|---|---|
| Nhận diện giọng nói (STT) | Web Speech API, ngôn ngữ `vi-VN`, hiển thị chữ ngay khi đang nói |
| Đọc câu trả lời (TTS) | Giọng tiếng Việt có sẵn trên thiết bị; **đọc từng câu ngay khi AI đang trả lời** (streaming) nên gần như không phải chờ |
| Trợ lý thông minh | Claude (Anthropic) với lời nhắc chuyên biệt cho người khiếm thị: câu ngắn, không ký hiệu, ưu tiên an toàn, nhớ ngữ cảnh hội thoại |
| Mắt thần | Chụp ảnh camera sau → mô tả: chướng ngại vật trước, đọc chữ (nhãn thuốc, biển báo, hoá đơn), nhận mệnh giá tiền Việt Nam, vị trí theo hướng đồng hồ |
| Âm báo & rung | Tiếng "bíp" khi bắt đầu/dừng nghe, tiếng màn trập khi chụp, âm trầm khi lỗi |
| Lệnh nhanh (xử lý trên máy) | "trợ giúp", "nhắc lại", "nói chậm hơn", "nói nhanh hơn", "cuộc trò chuyện mới", "dừng lại" |
| PWA | Thêm vào màn hình chính, chạy toàn màn hình, lưu đệm giao diện |

## Thiết kế tiếp cận (Accessibility)

- **Tương phản cao**: nền đen, chữ vàng `#FFD400` (tỉ lệ ~15:1) và trắng; chữ lớn, tự co giãn; hỗ trợ chế độ *forced colors* và *reduced motion*.
- **Chạm vào bất kỳ đâu** trên màn hình để bật/tắt micro; **giữ khoảng 1 giây** để chụp ảnh Mắt thần.
- **Ngắt lời**: khi trợ lý đang đọc, chạm một lần để dừng và nói tiếp ngay.
- **Phím tắt trên máy tính**:

  | Phím | Chức năng |
  |---|---|
  | `Space` (phím Cách) | Bắt đầu / dừng nói |
  | `C` | Chụp ảnh Mắt thần |
  | `R` | Nhắc lại câu trả lời |
  | `H` | Nghe hướng dẫn |
  | `Esc` | Dừng tất cả |

- Tương thích trình đọc màn hình (VoiceOver, TalkBack, NVDA): một nút lớn duy nhất có nhãn thay đổi theo trạng thái, vùng trạng thái `aria-live`, liên kết "bỏ qua" tới ô nhập.
- **Dự phòng nhập bàn phím** cho trình duyệt không có nhận diện giọng nói (ví dụ Firefox), người dùng màn hình chữ nổi, hoặc dùng nút micro đọc chính tả trên bàn phím iPhone.

## Cấu trúc thư mục

```
ai-tro-ly-khiem-thi/
├── server.js                  # Máy chủ Express: phục vụ PWA + API /api/chat, /api/vision (stream SSE)
├── src/
│   ├── prompts.js             # System prompt cho trợ lý và Mắt thần
│   └── rate-limit.js          # Giới hạn tần suất theo IP
├── public/                    # Frontend PWA (HTML/CSS/JS thuần, không cần build)
│   ├── index.html
│   ├── manifest.webmanifest   # Khai báo PWA
│   ├── sw.js                  # Service worker (lưu đệm giao diện)
│   ├── css/styles.css         # Giao diện tương phản cao
│   ├── js/
│   │   ├── app.js             # Điều phối trạng thái, cử chỉ, phím tắt, lệnh giọng nói
│   │   ├── speech.js          # STT + TTS (Web Speech API), đọc theo từng câu
│   │   ├── camera.js          # Mở camera sau, chụp và nén ảnh
│   │   ├── api.js             # Gọi API và đọc luồng SSE
│   │   └── sounds.js          # Âm báo, rung
│   └── icons/                 # Biểu tượng ứng dụng (SVG + PNG)
├── scripts/generate-icons.mjs # Tạo lại PNG từ SVG (tuỳ chọn)
├── .env.example
└── package.json
```

## Cài đặt và chạy

Yêu cầu: **Node.js 18 trở lên** và một khoá API Anthropic (tạo tại <https://console.anthropic.com>).

```bash
# 1. Cài thư viện
npm install

# 2. Tạo file cấu hình và điền khoá API
cp .env.example .env
#   mở .env, sửa ANTHROPIC_API_KEY=sk-ant-...

# 3. Chạy
npm start
# -> mở http://localhost:3000
```

Chế độ phát triển (tự khởi động lại khi sửa code): `npm run dev`.

### Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Khoá API (bắt buộc) |
| `PORT` | `3000` | Cổng máy chủ |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Mô hình Claude |
| `CHAT_EFFORT` | `low` | Mức suy luận khi trò chuyện (`low` cho phản hồi nhanh) |
| `VISION_EFFORT` | `medium` | Mức suy luận khi mô tả ảnh |
| `RATE_LIMIT_PER_MIN` | `20` | Số yêu cầu tối đa / phút / IP |

## Dùng trên điện thoại

Camera và micro trên trình duyệt **chỉ hoạt động qua HTTPS** (hoặc `localhost`). Để thử trên điện thoại:

- **Nhanh nhất**: dùng đường hầm HTTPS, ví dụ `npx localtunnel --port 3000` hoặc `cloudflared tunnel --url http://localhost:3000`, rồi mở địa chỉ `https://...` trên điện thoại.
- **Triển khai thật**: đưa lên dịch vụ hỗ trợ Node.js (Render, Railway, Fly.io, VPS + Nginx/Caddy có chứng chỉ HTTPS). Đặt `ANTHROPIC_API_KEY` trong phần biến môi trường của dịch vụ.

**Thêm vào màn hình chính**

- *iPhone (Safari)*: nút Chia sẻ → **Thêm vào MH chính**.
- *Android (Chrome)*: menu ⋮ → **Cài đặt ứng dụng** / **Thêm vào màn hình chính**.

**Giọng đọc tiếng Việt**: nếu ứng dụng báo "chưa có giọng đọc tiếng Việt":

- *Android*: Cài đặt → Hỗ trợ tiếp cận → Đầu ra chuyển văn bản thành giọng nói → Công cụ của Google → cài dữ liệu giọng **Tiếng Việt**.
- *iPhone*: Cài đặt → Trợ năng → Nội dung được đọc → Giọng nói → **Tiếng Việt** (tải giọng Linh).
- *Windows*: Cài đặt → Thời gian & Ngôn ngữ → Ngôn ngữ → thêm **Tiếng Việt** (kèm gói giọng nói). Microsoft Edge có sẵn giọng tiếng Việt chất lượng cao (HoaiMy, NamMinh).

**Trình duyệt khuyến nghị**: Chrome (Android, máy tính), Safari (iPhone), Edge (Windows). Firefox chưa hỗ trợ nhận diện giọng nói — dùng ô nhập bàn phím. Trên một số phiên bản iOS, nhận diện giọng nói có thể không hoạt động khi mở từ màn hình chính; khi đó hãy dùng nút micro trên bàn phím iPhone để đọc chính tả vào ô nhập.

## Kiến trúc và lưu ý kỹ thuật

```
Trình duyệt (PWA)                         Máy chủ Node.js                 Claude API
 ├─ Web Speech STT ─ văn bản ─┐
 ├─ Camera ─ ảnh JPEG ────────┼─ POST /api/chat | /api/vision ─► messages.stream ─►
 └─ Web Speech TTS ◄─ đọc từng câu ◄─ SSE từng đoạn văn bản ◄──────────────────────┘
```

- **Khoá API chỉ nằm trên máy chủ**, không bao giờ gửi xuống trình duyệt.
- **Streaming**: máy chủ chuyển tiếp từng đoạn văn bản (SSE); trình duyệt tách câu và đọc ngay → thời gian chờ đến tiếng nói đầu tiên ngắn.
- **Dự phòng khi bị từ chối nhầm**: yêu cầu bật `fallbacks: "default"` — nếu bộ lọc an toàn của mô hình từ chối nhầm, máy chủ Anthropic tự chạy lại trên mô hình dự phòng phù hợp.
- **Huỷ yêu cầu**: khi người dùng chạm để ngắt, kết nối bị đóng và máy chủ dừng sinh văn bản (tiết kiệm chi phí).
- **Riêng tư**: lịch sử hội thoại chỉ lưu trong phiên trình duyệt (`sessionStorage`), tối đa 20 lượt; máy chủ không lưu ảnh hay hội thoại. Camera tự tắt sau 30 giây không dùng hoặc khi chuyển ứng dụng.
- **Giới hạn**: ảnh tối đa 5 MB (ứng dụng tự nén về cạnh dài 1568 px), văn bản tối đa 4000 ký tự / lượt.

## Lưu ý pháp lý và vận hành (Việt Nam)

- **Bảo vệ dữ liệu cá nhân**: ảnh chụp có thể chứa khuôn mặt người khác, giấy tờ tuỳ thân, đơn thuốc — là dữ liệu cá nhân, có thể là dữ liệu nhạy cảm (sức khoẻ) theo **Luật Bảo vệ dữ liệu cá nhân số 91/2025/QH15** (hiệu lực từ 01/01/2026) và các văn bản hướng dẫn thi hành. Khi cung cấp dịch vụ công khai cần: thông báo và lấy sự đồng ý của người dùng, công bố chính sách quyền riêng tư, đánh giá tác động xử lý dữ liệu, và lưu ý việc **chuyển dữ liệu ra nước ngoài** (máy chủ Anthropic) phải lập hồ sơ đánh giá tác động chuyển dữ liệu.
- **Trách nhiệm về nội dung AI**: mô tả hình ảnh và câu trả lời có thể sai. Ứng dụng **không thay thế** gậy trắng, chó dẫn đường hay người hỗ trợ khi di chuyển, và không thay thế tư vấn y tế (đặc biệt khi đọc nhãn thuốc). Nên hiển thị/đọc tuyên bố miễn trừ trách nhiệm khi triển khai rộng.
- **Chi phí**: mỗi câu hỏi và mỗi ảnh đều tính phí theo token của Anthropic. Giữ `RATE_LIMIT_PER_MIN`, cân nhắc thêm xác thực người dùng trước khi công khai đường dẫn.
- **Tiêu chuẩn tiếp cận**: thiết kế hướng tới WCAG 2.1 mức AA (tương phản, kích thước vùng chạm ≥ 44 px, thao tác bằng bàn phím), phù hợp yêu cầu tiếp cận thông tin của **Luật Người khuyết tật 2010** và các quy định về trang thông tin điện tử hỗ trợ người khuyết tật.

## Hướng phát triển

- Tra cứu thông tin thời gian thực (thời tiết, tin tức) bằng công cụ tìm kiếm web của Claude.
- Chế độ "Mắt thần liên tục" mô tả định kỳ khi di chuyển.
- Đăng nhập, quản lý hạn mức theo người dùng; nhật ký sử dụng ẩn danh.
- Giọng đọc chất lượng cao từ máy chủ (TTS đám mây) cho thiết bị không có giọng tiếng Việt.
