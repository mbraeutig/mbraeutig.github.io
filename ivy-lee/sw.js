// Ivy Lee service worker: offline start, nothing else (same approach as Carry).
// Network first, cache as fallback: online always the newest version (no stale app after a
// deploy), offline the last version that was loaded. A slow network gets 3 seconds, then the
// cached version answers and the network response only updates the cache for the next start.
// Files with a content hash in their name never change, so they come from the cache first.
// Only registered in production builds.

// Own name: Carry lives on the same origin (mbraeutig.github.io) and keeps its cache "carry".
const CACHE = 'ivy-lee';
const NETWORK_TIMEOUT = 3000;

// Build files with a content hash in their name, e.g. main-SWOATOGQ.js or styles-3EKIOEEX.css.
const HASHED = /\/[a-z]+-[A-Z0-9]{8}\.(?:js|css)$/;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (HASHED.test(new URL(request.url).pathname)) {
    event.respondWith(cacheFirst(event, request));
    return;
  }
  const network = fetch(request);
  // Stores whatever the network brings, even if the cache answered first.
  event.waitUntil(network.then((response) => store(request, response)).catch(() => {}));
  event.respondWith(networkFirst(request, network));
});

async function networkFirst(request, network) {
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
  if (!response.ok) return;
  const copy = response.clone(); // now, before the page reads the body
  const cache = await caches.open(CACHE);
  if (request.mode !== 'navigate') {
    await cache.put(request, copy);
    return;
  }
  // A new app page replaces the cached one only together with its build files. Otherwise a deploy
  // that arrives in the background (slow network: the cached page answered) would leave a page
  // whose scripts are missing – offline a blank screen. If a file fails, the old page stays.
  const html = await copy.clone().text();
  await cacheBuildFiles(cache, html, request.url);
  await cache.put(request, copy);
  await removeOldBuildFiles(cache, html);
}

// The hashed files the page references: scripts and styles.
async function cacheBuildFiles(cache, html, pageUrl) {
  for (const name of new Set(html.match(/[\w./-]+-[A-Z0-9]{8}\.(?:js|css)/g))) {
    const url = new URL(name, pageUrl).href;
    if (await cache.match(url)) continue;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    await cache.put(url, response);
  }
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
