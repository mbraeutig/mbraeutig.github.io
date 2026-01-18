// ========================================
// 間 Ma - Service Worker
// Ermöglicht Offline-Nutzung der PWA
// ========================================

const CACHE_NAME = 'ma-app-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// Google Fonts für Offline-Nutzung
const FONT_CACHE_NAME = 'ma-fonts-v1';
const GOOGLE_FONTS_URLS = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500&family=Noto+Sans+JP:wght@300;400&display=swap'
];

// ========================================
// INSTALL EVENT
// Cache statische Assets
// ========================================
self.addEventListener('install', (event) => {
  console.log('[SW] Installing Service Worker...');

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching app shell...');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => {
        console.log('[SW] App shell cached successfully');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('[SW] Failed to cache app shell:', error);
      })
  );
});

// ========================================
// ACTIVATE EVENT
// Alte Caches löschen
// ========================================
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating Service Worker...');

  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME && name !== FONT_CACHE_NAME)
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[SW] Service Worker activated');
        return self.clients.claim();
      })
  );
});

// ========================================
// FETCH EVENT
// Cache-First Strategie für Assets
// Network-First für dynamische Inhalte
// ========================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Google Fonts: Cache-First mit Network-Fallback
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(FONT_CACHE_NAME)
        .then((cache) => {
          return cache.match(request)
            .then((cachedResponse) => {
              if (cachedResponse) {
                return cachedResponse;
              }

              return fetch(request)
                .then((networkResponse) => {
                  cache.put(request, networkResponse.clone());
                  return networkResponse;
                })
                .catch(() => {
                  // Fonts nicht verfügbar - App funktioniert trotzdem mit System-Fonts
                  return new Response('', { status: 200 });
                });
            });
        })
    );
    return;
  }

  // Lokale Assets: Cache-First
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }

          return fetch(request)
            .then((networkResponse) => {
              // Nur erfolgreiche Responses cachen
              if (networkResponse && networkResponse.status === 200) {
                const responseClone = networkResponse.clone();
                caches.open(CACHE_NAME)
                  .then((cache) => {
                    cache.put(request, responseClone);
                  });
              }
              return networkResponse;
            })
            .catch(() => {
              // Offline-Fallback für HTML
              if (request.headers.get('accept').includes('text/html')) {
                return caches.match('/index.html');
              }
              return new Response('Offline', { status: 503 });
            });
        })
    );
    return;
  }

  // Alle anderen Requests: Network-First
  event.respondWith(
    fetch(request)
      .catch(() => caches.match(request))
  );
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

console.log('[SW] Service Worker loaded');
