// Service worker Running Coach: offline shell + web push. Vanilla JS, tanpa build step.
const VERSION = "rc-v1";
const STATIC = VERSION + "-static";
const PAGES = VERSION + "-pages";
const PRECACHE = ["/offline", "/pwa-icon/192", "/pwa-icon/512"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(STATIC).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (!k.startsWith(VERSION)) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Cache halaman dihapus saat logout supaya data tidak tertinggal di perangkat.
self.addEventListener("message", (e) => {
  if (e.data === "clear-pages") e.waitUntil(caches.delete(PAGES));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return; // POST (log, check-in) ditangani antrean offline di app
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/") || url.pathname === "/login") return;

  // aset build & ikon: immutable → cache-first
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/pwa-icon/")) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(STATIC).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }

  // halaman & payload RSC: network-first, simpan salinan terakhir untuk offline
  const isPage = req.mode === "navigate" || req.headers.get("RSC") === "1";
  if (!isPage) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok && !res.redirected) { const copy = res.clone(); caches.open(PAGES).then((c) => c.put(req, copy)); }
      return res;
    } catch (err) {
      const hit = await caches.match(req);
      if (hit) return hit;
      if (req.mode === "navigate") {
        const off = await caches.match("/offline");
        if (off) return off;
      }
      throw err;
    }
  })());
});

self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(data.title || "Running Coach", {
    body: data.body || "",
    tag: data.tag || "rc",
    icon: "/pwa-icon/192",
    badge: "/pwa-icon/192",
    data: { url: data.url || "/" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if ("focus" in c) {
        await c.focus();
        if ("navigate" in c) await c.navigate(url);
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
