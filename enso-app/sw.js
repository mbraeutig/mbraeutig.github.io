/* ========================================
   ENSO - Service Worker
   Enables offline functionality

   Strategie:
   - Seitenaufrufe (HTML): Network-first. Neue Versionen kommen sofort an,
     offline wird die gecachte index.html ausgeliefert.
   - Statische Assets: Stale-while-revalidate. Sofort aus dem Cache,
     im Hintergrund wird aktualisiert.

   Alle Pfade sind relativ zum Service Worker, damit die App auch in einem
   Unterordner läuft (z. B. GitHub Pages: user.github.io/Enso-App/).

   CACHE_VERSION erhöhen, wenn sich die Liste der vorab gecachten Dateien
   ändert oder alte Caches sofort verworfen werden sollen.
======================================== */

const CACHE_VERSION = 3;
const CACHE_NAME = `enso-v${CACHE_VERSION}`;

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

const INDEX_URL = new URL('./index.html', self.location).href;

// Install: Cache all essential assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

// Activate: Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((name) => name.startsWith('enso-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

function putInCache(request, response) {
  if (!response || response.status !== 200 || response.type !== 'basic') return;
  const copy = response.clone();
  caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
}

// Network-first for navigations
function handleNavigation(event) {
  return fetch(event.request)
    .then((response) => {
      putInCache(event.request, response);
      return response;
    })
    .catch(() =>
      caches.match(event.request, { ignoreSearch: true })
        .then((cached) => cached || caches.match(INDEX_URL))
    );
}

// Stale-while-revalidate for static assets
function handleAsset(event) {
  return caches.match(event.request).then((cached) => {
    const network = fetch(event.request)
      .then((response) => {
        putInCache(event.request, response);
        return response;
      })
      .catch(() => cached || Response.error());

    if (cached) {
      event.waitUntil(network);
      return cached;
    }
    return network;
  });
}

self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Only handle same-origin requests (Google Fonts etc. go straight to network)
  if (new URL(event.request.url).origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(handleNavigation(event));
  } else {
    event.respondWith(handleAsset(event));
  }
});
