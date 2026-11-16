// Minamo service worker (taken over from Carry): offline start, nothing else.
// Network first, cache as fallback: online always the newest version (no stale app after a
// deploy), offline the last version that was loaded. A slow network gets 3 seconds, then the
// cached version answers and the network response only updates the cache for the next start.
// Files with a content hash in their name never change, so they come from the cache first.
// Only registered in production builds.
const CACHE = 'minamo';
const NETWORK_TIMEOUT = 3000;

// Build files with a content hash in their name, e.g. main-SWOATOGQ.js, styles-3EKIOEEX.css or
// media/noto-serif-latin-wght-normal-SE7LSV22.woff2.
const IMMUTABLE = /-[A-Z0-9]{8}\.(?:js|css|woff2)$/;
const BUILD_FILE = /[\w./-]+-[A-Z0-9]{8}\.(?:js|css|woff2)/g;

// The page that installs the worker was loaded without it, so nothing would be cached until the
// second visit. Caching the app page right at install makes one visit enough for an offline start.
// A failure (e.g. the network drops) must not stop the install: the next visit caches it anyway.
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(cacheAppPage().catch(() => {}));
});
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
  // Offline: a URL with a query (share target, step 12) must still find the cached app page.
  const cached = () => caches.match(request, { ignoreSearch: request.mode === 'navigate' });
  let timer;
  const slow = new Promise((resolve) => (timer = setTimeout(resolve, NETWORK_TIMEOUT))).then(cached);
  try {
    // The cache only wins after the timeout, and only if it has a copy (else keep waiting).
    return (await Promise.race([network, slow])) ?? (await network);
  } catch {
    return (await cached()) ?? Response.error();
  } finally {
    clearTimeout(timer);
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
  const files = await cacheBuildFiles(cache, html, self.registration.scope);
  // Not the app page (e.g. an icon opened in a tab): keep it, but leave the build files alone.
  if (!files.size) {
    await cache.put(request, copy);
    return;
  }
  // One app page, stored without its query: share-target URLs would otherwise pile up, each an
  // old page whose build files get removed – and the offline lookup (ignoreSearch) might pick one.
  const page = new URL(request.url);
  page.search = '';
  await cache.put(page.href, copy);
  await removeOldBuildFiles(cache, files);
}

// The start page of the scope (e.g. /minamo/) with its build files, as a navigation would store it.
async function cacheAppPage() {
  const url = self.registration.scope;
  const response = await fetch(url);
  if (!response.ok) return;
  const cache = await caches.open(CACHE);
  const html = await response.clone().text();
  await cacheBuildFiles(cache, html, url);
  await cache.put(url, response);
}

// The hashed files a page or stylesheet references: scripts, styles and, inside the styles, the
// fonts. Relative names resolve against the referencing file. Returns the URLs of all of them.
async function cacheBuildFiles(cache, text, baseUrl, found = new Set()) {
  const names = new Set(text.match(BUILD_FILE));
  await Promise.all(
    [...names].map(async (name) => {
      const url = new URL(name, baseUrl).href;
      if (found.has(url)) return;
      found.add(url);
      let response = await cache.match(url);
      if (!response) {
        response = await fetch(url);
        if (!response.ok) throw new Error(`${url}: ${response.status}`);
        await cache.put(url, response.clone());
      }
      if (url.endsWith('.css')) await cacheBuildFiles(cache, await response.text(), url, found);
    }),
  );
  return found;
}

// After a deploy the old hashed files are never requested again: drop the ones the freshly
// loaded page no longer references, so the cache does not grow with every deploy.
async function removeOldBuildFiles(cache, keep) {
  for (const cached of await cache.keys()) {
    const inScope = cached.url.startsWith(self.registration.scope);
    if (inScope && IMMUTABLE.test(new URL(cached.url).pathname) && !keep.has(cached.url)) {
      await cache.delete(cached);
    }
  }
}
