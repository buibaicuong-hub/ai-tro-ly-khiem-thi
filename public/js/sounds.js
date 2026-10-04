// Âm báo ngắn (earcon) và rung để người dùng biết trạng thái mà không cần nhìn.

let ctx = null;

function audio() {
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = new AudioCtx();
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

// Gọi trong một thao tác chạm/bấm phím đầu tiên để iOS cho phép phát âm thanh.
export function unlockAudio() {
  audio();
}

function tone(freq, start, duration, { type = "sine", gain = 0.18 } = {}) {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + start;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

function vibrate(pattern) {
  if (navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch { /* bỏ qua */ }
  }
}

export const sounds = {
  // Bắt đầu nghe: hai nốt đi lên
  listenStart() {
    tone(660, 0, 0.12);
    tone(990, 0.1, 0.16);
    vibrate(40);
  },
  // Dừng nghe: hai nốt đi xuống
  listenStop() {
    tone(880, 0, 0.1);
    tone(587, 0.09, 0.14);
    vibrate(20);
  },
  // Đang xử lý: một nốt nhẹ
  thinking() {
    tone(523, 0, 0.18, { gain: 0.08 });
  },
  // Màn trập máy ảnh
  shutter() {
    const ac = audio();
    if (!ac) return;
    const len = Math.floor(ac.sampleRate * 0.08);
    const buffer = ac.createBuffer(1, len, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ac.createBufferSource();
    const g = ac.createGain();
    g.gain.value = 0.35;
    src.buffer = buffer;
    src.connect(g).connect(ac.destination);
    src.start();
    vibrate([30, 40, 30]);
  },
  // Lỗi: nốt trầm
  error() {
    tone(196, 0, 0.3, { type: "square", gain: 0.08 });
    vibrate([80, 60, 80]);
  },
};
