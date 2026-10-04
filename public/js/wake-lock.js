// Giữ màn hình sáng (Screen Wake Lock API) trong lúc nghe/đọc, vì khi điện thoại tự khoá
// màn hình, trình duyệt sẽ dừng nhận diện và đọc giọng nói.

export class ScreenWake {
  constructor() {
    this.sentinel = null;
    this.wanted = false;
    document.addEventListener("visibilitychange", () => {
      // Khoá bị hệ thống thu hồi khi ẩn trang; xin lại khi trang hiện ra.
      if (!document.hidden && this.wanted) this.acquire();
    });
  }

  async acquire() {
    this.wanted = true;
    if (this.sentinel || !("wakeLock" in navigator) || document.hidden) return;
    try {
      this.sentinel = await navigator.wakeLock.request("screen");
      this.sentinel.addEventListener("release", () => { this.sentinel = null; });
    } catch { /* không hỗ trợ hoặc bị từ chối - bỏ qua */ }
  }

  release() {
    this.wanted = false;
    const s = this.sentinel;
    this.sentinel = null;
    s?.release().catch(() => {});
  }
}
