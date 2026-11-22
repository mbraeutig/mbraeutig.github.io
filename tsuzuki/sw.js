// Tsuzuki Service Worker — Offline-First, schlicht.
// CACHE wird von deploy.js bei jedem Deploy neu gestempelt. Ohne neuen Namen
// bekämen installierte Apps nie neuen Code (Cache-First).
const CACHE = 'tsuzuki-20261122-100741';
const ASSETS = [
  'index.html', 'core.js', 'app.js', 'manifest.webmanifest',
  'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-512-maskable.png'
];
self.addEventListener('install', e => {
  // cache:'reload' umgeht den HTTP-Cache (GitHub Pages: max-age=600) —
  // sonst würde ein neuer Worker womöglich die alten Dateien einlagern.
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      }
      return res;
    }).catch(() =>
      // Offline-Rückfall auf die App-Seite nur beim Seitenaufruf — ein Bild
      // oder Skript bekommt kein HTML untergeschoben, sondern einen Fehler.
      e.request.mode === 'navigate' ? caches.match('index.html') : Response.error()
    ))
  );
});
