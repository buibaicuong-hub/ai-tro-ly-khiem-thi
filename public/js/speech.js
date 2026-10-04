// Nhận diện giọng nói (STT) và đọc văn bản (TTS) tiếng Việt bằng Web Speech API.

const LANG = "vi-VN";

/* ------------------------------------------------------------------ */
/* TTS - đọc văn bản                                                   */
/* ------------------------------------------------------------------ */

export class Speaker {
  constructor() {
    this.synth = window.speechSynthesis || null;
    this.voice = null;
    this.rate = 1;
    this.buffer = "";
    this.pending = new Set(); // giữ tham chiếu để Chrome không thu gom utterance giữa chừng
    this.onIdle = null;
    this.streamOpen = false;

    if (this.synth) {
      this.pickVoice();
      this.synth.addEventListener?.("voiceschanged", () => this.pickVoice());
    }
  }

  get supported() {
    return Boolean(this.synth);
  }

  get hasVietnameseVoice() {
    return Boolean(this.voice);
  }

  get speaking() {
    return this.pending.size > 0;
  }

  pickVoice() {
    const voices = this.synth.getVoices();
    const vi = voices.filter((v) => /^vi([-_]|$)/i.test(v.lang));
    // Ưu tiên giọng chất lượng cao (online / natural / Google), sau đó giọng mặc định.
    const score = (v) =>
      (/natural|online|neural|google|premium|enhanced/i.test(v.name) ? 4 : 0) +
      (v.localService ? 0 : 1) +
      (v.default ? 1 : 0);
    vi.sort((a, b) => score(b) - score(a));
    this.voice = vi[0] || null;
  }

  // iOS chỉ cho phép phát giọng nói sau thao tác người dùng: gọi hàm này trong lần chạm đầu.
  unlock() {
    if (!this.synth || this.unlocked) return;
    this.unlocked = true;
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    u.lang = LANG;
    this.synth.speak(u);
  }

  /** Đọc trọn một đoạn văn bản (huỷ những gì đang đọc). */
  say(text) {
    this.stop();
    this.beginStream();
    this.push(text);
    this.endStream();
  }

  /** Bắt đầu nhận văn bản dạng luồng; đọc từng câu ngay khi đủ câu. */
  beginStream() {
    this.buffer = "";
    this.streamOpen = true;
  }

  push(text) {
    this.buffer += text;
    let match;
    // Cắt tại dấu kết thúc câu theo sau bởi khoảng trắng / xuống dòng.
    const boundary = /([\s\S]*?[.!?…;:\n]+)(\s+|$)/;
    while ((match = boundary.exec(this.buffer)) && match[2] !== "") {
      this.enqueue(match[1]);
      this.buffer = this.buffer.slice(match[0].length);
    }
    // Câu quá dài không có dấu chấm: cắt tại dấu phẩy để bắt đầu đọc sớm.
    if (this.buffer.length > 220) {
      const cut = this.buffer.lastIndexOf(",", 200);
      if (cut > 40) {
        this.enqueue(this.buffer.slice(0, cut + 1));
        this.buffer = this.buffer.slice(cut + 1);
      }
    }
  }

  endStream() {
    this.streamOpen = false;
    if (this.buffer.trim()) this.enqueue(this.buffer);
    this.buffer = "";
    this.checkIdle();
  }

  enqueue(raw) {
    const text = cleanForSpeech(raw);
    if (!text || !this.synth) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LANG;
    if (this.voice) u.voice = this.voice;
    u.rate = this.rate;
    const done = () => {
      // Utterance đã bị huỷ bởi stop(): bỏ qua để không đổi trạng thái ứng dụng.
      if (!this.pending.has(u)) return;
      this.pending.delete(u);
      this.checkIdle();
    };
    u.onend = done;
    u.onerror = done;
    this.pending.add(u);
    this.synth.speak(u);
  }

  checkIdle() {
    if (!this.streamOpen && this.pending.size === 0 && this.onIdle) this.onIdle();
  }

  stop() {
    this.streamOpen = false;
    this.buffer = "";
    this.pending.clear();
    if (this.synth) this.synth.cancel();
  }
}

// Loại bỏ ký hiệu Markdown/emoji mà giọng đọc sẽ đọc lên một cách khó chịu.
export function cleanForSpeech(text) {
  return text
    .replace(/https?:\/\/\S+/g, "đường link")
    .replace(/[*_#`>|~]+/g, " ")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ */
/* STT - nhận diện giọng nói                                           */
/* ------------------------------------------------------------------ */

export class Listener {
  constructor() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.Recognition = Recognition || null;
    this.recognition = null;
    this.listening = false;
  }

  get supported() {
    return Boolean(this.Recognition);
  }

  /**
   * Bắt đầu nghe một câu nói.
   * @param {{onInterim?: (t:string)=>void}} handlers
   * @returns {Promise<string>} văn bản cuối cùng ("" nếu không nghe thấy gì)
   */
  listen({ onInterim } = {}) {
    if (!this.Recognition) return Promise.reject(new Error("unsupported"));
    this.abort();

    return new Promise((resolve, reject) => {
      const rec = new this.Recognition();
      this.recognition = rec;
      rec.lang = LANG;
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;

      let finalText = "";
      let interimText = "";

      rec.onresult = (event) => {
        interimText = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const r = event.results[i];
          if (r.isFinal) finalText += r[0].transcript;
          else interimText += r[0].transcript;
        }
        onInterim?.((finalText + " " + interimText).trim());
      };

      rec.onerror = (event) => {
        // "no-speech" và "aborted" không phải lỗi thực sự.
        if (event.error === "no-speech" || event.error === "aborted") return;
        this.listening = false;
        reject(new Error(event.error || "speech-error"));
      };

      rec.onend = () => {
        this.listening = false;
        this.recognition = null;
        // Bị huỷ thì bỏ kết quả; bị dừng giữa chừng thì dùng phần tạm thời đã nghe được.
        resolve(rec.cancelled ? "" : (finalText || interimText).trim());
      };

      try {
        rec.start();
        this.listening = true;
      } catch (err) {
        this.listening = false;
        reject(err);
      }
    });
  }

  /** Dừng nghe và xử lý những gì đã nghe được. */
  stop() {
    if (this.recognition) this.recognition.stop();
  }

  /** Huỷ nghe, bỏ kết quả. */
  abort() {
    if (this.recognition) {
      const rec = this.recognition;
      rec.cancelled = true;
      rec.abort();
    }
    this.recognition = null;
    this.listening = false;
  }
}
