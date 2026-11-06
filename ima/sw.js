"use strict";
/* ============================================================
   Ima 今 — Service Worker
   Eine einzige Aufgabe: offline funktionieren (Definition of Done 1).
   Kein Push, kein Background-Sync, kein Tracking (Konzept §3).

   Strategie: sofort aus dem Cache antworten, im Hintergrund frisch holen
   (stale-while-revalidate). Die App startet also immer ohne Netz; eine neue
   Version ist ab dem *nächsten* Öffnen da. Cache-First im Sinne von §7.1,
   ohne dass Updates an einer Versionsnummer in dieser Datei hängen.
   ============================================================ */
const CACHE = "ima-v1";
const SHELL = ["./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

// Nur eigene alte Caches aufräumen: Ima teilt sich den Origin (mbraeutig.github.io)
// mit anderen Apps samt deren Caches — die gehen Ima nichts an.
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(k => k.startsWith("ima-") && k !== CACHE)
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  // Jede Navigation (/, /index.html, /?lab, /?fangen) ist dieselbe eine Seite
  const key = req.mode === "navigate" ? "./index.html" : req;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(key, { ignoreSearch: true });
    const fresh = fetch(req)
      .then(res => { if (res.ok) cache.put(key, res.clone()); return res; })
      .catch(() => cached || Response.error());
    if (cached) { e.waitUntil(fresh); return cached; }
    return fresh;
  }));
});
