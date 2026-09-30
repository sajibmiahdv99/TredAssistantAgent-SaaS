// AI TRED AGENT Service Worker v1
const CACHE = "aitredagent-v2";
const PRECACHE = ["/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  const url = new URL(request.url);

  if (request.method !== "GET") return;
  if (url.origin !== location.origin) return;

  // Authenticated HTML, server-function RPCs and APIs must always use the network.
  // Only fingerprinted build assets are safe to share in this browser cache.
  if (!url.pathname.startsWith("/assets/")) return;

  // Cache-first for static assets
  e.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(request, clone));
        }
        return res;
      });
    }),
  );
});
