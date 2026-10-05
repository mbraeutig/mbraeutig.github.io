// Carry service worker: offline start, nothing else.
// Network first, cache as fallback: online always the newest version (no stale app after a
// deploy), offline the last version that was loaded. A slow network gets 3 seconds, then the
// cached version answers and the network response only updates the cache for the next start.
// Files with a content hash in their name never change, so they come from the cache first.
// Only registered in production builds.
const CACHE = 'carry';
const NETWORK_TIMEOUT = 3000;

// Build files with a content hash in their name, e.g. main-SWOATOGQ.js or styles-3EKIOEEX.css.
const HASHED = /\/[a-z]+-[A-Z0-9]{8}\.(?:js|css)$/;
// Same for the self-hosted fonts (referenced from the CSS, so not cleaned up by HASHED).
const IMMUTABLE = /-[A-Z0-9]{8}\.(?:js|css|woff2)$/;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (IMMUTABLE.test(new URL(request.url).pathname)) {
    event.respondWith(cacheFirst(event, request));
    return;
  }
  const network = fetch(request);
  // Stores whatever the network brings, even if the cache answered first.
  event.waitUntil(network.then((response) => store(request, response)).catch(() => {}));
  event.respondWith(networkFirst(request, network));
});

async function networkFirst(request, network) {
  // Offline: "?add=…" links must still find the cached app page.
  const cached = () => caches.match(request, { ignoreSearch: request.mode === 'navigate' });
  const slow = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT)).then(cached);
  try {
    // The cache only wins after the timeout, and only if it has a copy (else keep waiting).
    return (await Promise.race([network, slow])) ?? (await network);
  } catch {
    return (await cached()) ?? Response.error();
  }
}

async function cacheFirst(event, request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  event.waitUntil(store(request, response));
  return response;
}

async function store(request, response) {
  // Opaque: cross-origin responses without CORS; still worth keeping for offline.
  if (!response.ok && response.type !== 'opaque') return;
  const copy = response.clone();
  const cache = await caches.open(CACHE);
  await cache.put(request, copy.clone());
  if (request.mode === 'navigate') await removeOldBuildFiles(cache, await copy.text());
}

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
