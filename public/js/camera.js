// Mắt thần: mở camera sau, chụp một khung hình và nén thành JPEG để gửi lên máy chủ.

const MAX_SIDE = 1568;          // cạnh dài tối ưu cho phân tích ảnh của Claude
const JPEG_QUALITY = 0.85;
const IDLE_CLOSE_MS = 30_000;   // tự tắt camera sau 30 giây không dùng (tiết kiệm pin, riêng tư)

export class Camera {
  constructor(videoEl) {
    this.video = videoEl;
    this.stream = null;
    this.closeTimer = null;
  }

  get supported() {
    return Boolean(navigator.mediaDevices?.getUserMedia);
  }

  async open() {
    clearTimeout(this.closeTimer);
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {});
    await waitForFrame(this.video);
    document.body.classList.add("camera-on");
  }

  /** Chụp ảnh, trả về data URL JPEG. */
  async capture() {
    await this.open();
    // Chờ camera tự cân bằng sáng / lấy nét sau khi vừa mở.
    await delay(this.justOpened() ? 700 : 150);
    const { videoWidth: w, videoHeight: h } = this.video;
    if (!w || !h) throw new Error("no-frame");
    const dataUrl = drawScaled(this.video, w, h);
    this.scheduleClose();
    return dataUrl;
  }

  justOpened() {
    const t = this.video.currentTime;
    return Number.isFinite(t) && t < 1;
  }

  scheduleClose() {
    clearTimeout(this.closeTimer);
    this.closeTimer = setTimeout(() => this.close(), IDLE_CLOSE_MS);
  }

  close() {
    clearTimeout(this.closeTimer);
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.video.srcObject = null;
    document.body.classList.remove("camera-on");
  }
}

/** Đọc ảnh từ <input type="file"> (dự phòng khi không mở được camera trực tiếp). */
export async function fileToDataUrl(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return drawScaled(img, img.naturalWidth, img.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawScaled(source, w, h) {
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

function waitForFrame(video) {
  if (video.readyState >= 2 && video.videoWidth) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener("loadeddata", done);
      resolve();
    };
    video.addEventListener("loadeddata", done);
    setTimeout(done, 3000);
  });
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
