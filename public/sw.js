/* Quietly Here — service worker
   - Precaches the app shell so it opens instantly / offline.
   - Network-FIRST for the app shell (HTML/CSS/JS) so code updates always reach
     installed apps (previously cache-first froze old copies on phones).
   - Network-first for API calls (fresh stories/comments), falling back to cache.
   - Cache-first only for images/fonts (rarely change). */
const CACHE = "quietly-v3";
const SHELL = [
  "/", "/index.html", "/app.css", "/app-shell.css", "/app.js",
  "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// treat HTML/CSS/JS as "shell" that must stay fresh
function isShell(url) {
  return url.pathname === "/" ||
    url.pathname.endsWith(".html") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".webmanifest");
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // API + app shell: network-first (always try fresh), fall back to cache offline
  if (url.pathname.startsWith("/api/") || isShell(url)) {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // images/fonts/etc: cache-first, refresh in background
  e.respondWith(
    caches.match(req).then((cached) => {
      const fetched = fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }).catch(() => cached);
      return cached || fetched;
    })
  );
});
