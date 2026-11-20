// ========================================
// 間 Ma - Service Worker
// Ermöglicht Offline-Nutzung der PWA
//
// Alle Pfade sind relativ zum Ort dieser Datei, damit die App
// auch unter einem Unterpfad läuft (z.B. https://<user>.github.io/Ma-App/).
//
// RELEASE-REGEL: Bei jeder Änderung an App-Dateien CACHE_VERSION erhöhen,
// damit Icons/Manifest neu geladen und alte Caches entfernt werden.
// ========================================

const CACHE_VERSION = 4;
const CACHE_NAME = `ma-app-v${CACHE_VERSION}`;
const INDEX_URL = './index.html';

// Alles, was die App zum Laufen braucht – inkl. Font, damit sie offline
// ab dem ersten Start vollständig aussieht. Keine externen Ressourcen.
const ASSETS_TO_CACHE = [
  './',
  INDEX_URL,
  './manifest.json',
  './fonts/inter-latin-wght-normal.woff2',
  './icons/icon.svg',
  './icons/icon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

// ========================================
// INSTALL EVENT
// App Shell cachen. Schlägt das fehl, schlägt die Installation fehl –
// sonst gäbe es einen "installierten" Worker ohne Offline-Fähigkeit.
// ========================================
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // cache: 'reload' umgeht den HTTP-Cache, damit wirklich der aktuelle Stand im Cache landet
      .then((cache) => cache.addAll(
        ASSETS_TO_CACHE.map((url) => new Request(url, { cache: 'reload' }))
      ))
      .then(() => self.skipWaiting())
  );
});

// ========================================
// ACTIVATE EVENT
// Alte Caches löschen (inkl. des früheren Google-Fonts-Caches 'ma-fonts-v1') —
// nur die eigenen ('ma-…'): Der Origin mbraeutig.github.io ist mit anderen
// Apps geteilt, deren Caches bleiben unangetastet
// ========================================
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((name) => name.startsWith('ma-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

// ========================================
// FETCH EVENT
// - Navigation (HTML): Network-First → Updates kommen sofort an, offline aus dem Cache
// - Lokale Assets:     Cache-First (Font, Icons, Manifest)
// ========================================
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Nur GET-Requests sind cachebar
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // Seitenaufrufe: Network-First
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse.ok) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(INDEX_URL, responseClone));
          }
          return networkResponse;
        })
        .catch(() => caches.match(INDEX_URL))
    );
    return;
  }

  // Lokale Assets: Cache-First
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }

          return fetch(request)
            .then((networkResponse) => {
              if (networkResponse.ok) {
                const responseClone = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
              }
              return networkResponse;
            })
            .catch(() => new Response('Offline', { status: 503 }));
        })
    );
  }

  // Alle anderen Requests: Browser-Standard (kein respondWith)
});

// ========================================
// MESSAGE EVENT
// Kommunikation mit der App
// ========================================
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
