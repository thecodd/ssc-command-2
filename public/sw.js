const CACHE = "cgl-shell-v2";
const SHELL = ["/manifest.json", "/icons/icon-192.png", "/offline.html"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== CACHE).map((x) => caches.delete(x))))); self.clients.claim(); });
// Only static assets are cached. Pages, server actions and Supabase calls always go to the network (per-user, per-request data must never be served stale);
// when the network is down a page navigation shows the offline screen.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  if (req.mode === "navigate") { e.respondWith(fetch(req).catch(() => caches.match("/offline.html"))); return; }
  e.respondWith(fetch(req).then((r) => { if (r.ok && req.url.includes("/_next/static/")) { const c = r.clone(); caches.open(CACHE).then((x) => x.put(req, c)); } return r; }).catch(() => caches.match(req)));
});
