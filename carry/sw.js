// Carry service worker: offline start, nothing else.
// Network first, cache as fallback: online always the newest version (no stale app after a
// deploy), offline the last version that was loaded. Only registered in production builds.
const CACHE = 'carry';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Opaque: cross-origin font CSS without CORS; still worth keeping for offline.
        if (response.ok || response.type === 'opaque') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      // Offline: "?add=…" links must still find the cached app page.
      .catch(() => caches.match(request, { ignoreSearch: request.mode === 'navigate' })),
  );
});
