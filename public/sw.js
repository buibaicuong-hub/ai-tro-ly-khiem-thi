// Service worker: lưu đệm giao diện để mở nhanh và mở được khi mạng yếu.
// Các yêu cầu /api/* luôn đi qua mạng (cần máy chủ AI).

const CACHE = "sang-mat-v2";
const APP_SHELL = [
  "/",
  "/index.html",
  "/css/styles.css",
  "/js/app.js",
  "/js/speech.js",
  "/js/camera.js",
  "/js/api.js",
  "/js/sounds.js",
  "/js/commands.js",
  "/js/wake-lock.js",
  "/privacy.html",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    return; // để trình duyệt xử lý bình thường
  }

  // Mạng trước, đệm sau: luôn lấy bản mới khi có mạng, dùng bản lưu khi mất mạng.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") return caches.match("/index.html");
        return Response.error();
      }),
  );
});
