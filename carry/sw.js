// Carry service worker: offline start, nothing else.
// Network first, cache as fallback: online always the newest version (no stale app after a
// deploy), offline the last version that was loaded. Only registered in production builds.
const CACHE = 'carry';

// Build files with a content hash in their name, e.g. main-SWOATOGQ.js or styles-3EKIOEEX.css.
const HASHED = /\/[a-z]+-[A-Z0-9]{8}\.(?:js|css)$/;

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
          event.waitUntil(
            caches.open(CACHE).then(async (cache) => {
              await cache.put(request, copy.clone());
              if (request.mode === 'navigate') await removeOldBuildFiles(cache, await copy.text());
            }),
          );
        }
        return response;
      })
      // Offline: "?add=…" links must still find the cached app page.
      .catch(() => caches.match(request, { ignoreSearch: request.mode === 'navigate' })),
  );
});

// After a deploy the old hashed files are never requested again: drop the ones the freshly
// loaded page no longer references, so the cache does not grow with every deploy.
async function removeOldBuildFiles(cache, html) {
  for (const cached of await cache.keys()) {
    const path = new URL(cached.url).pathname;
    if (HASHED.test(path) && !html.includes(path.slice(path.lastIndexOf('/') + 1))) {
      await cache.delete(cached);
    }
  }
}
