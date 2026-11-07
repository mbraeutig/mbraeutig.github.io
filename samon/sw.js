// Samon – Service Worker (KONZEPT.md §10). Einzige Aufgabe: offline laufen.
// publish.mjs setzt VERSION (Inhalts-Hash) und FILES. Im Repo ('dev') greift er nicht ein.
// Eigene Dateien Cache-First, Google-Schriften im selben versionierten Cache.
// Samon teilt sich den Origin mit anderen Apps: nur eigene Dateien beantworten,
// nur eigene Caches („samon-“) aufräumen.

const VERSION = '81a40fe699';
const FILES = [
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/book.js',
  './js/generator.js',
  './js/input.js',
  './js/render.js',
  './js/rng.js',
  './js/rules.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/icon.svg',
];
const DEV = VERSION === 'dev';
const CACHE = `samon-${VERSION}`;

const SCOPE = new URL('./', self.location).href;
const SHELL = new URL('./index.html', self.location).href;
const OWN = new Set(FILES.map(f => new URL(f, self.location).href));

self.addEventListener('install', e => {
  if (DEV) { self.skipWaiting(); return; }
  // cache: 'reload' umgeht den HTTP-Cache, sonst landen alte Dateien im neuen Cache.
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(k => k.startsWith('samon-') && k !== CACHE)
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (DEV || req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(font(e, req, url));
    return;
  }
  const plain = url.origin + url.pathname;
  // Die App selbst (./ mit beliebiger Query) ist die eine Seite.
  const key = req.mode === 'navigate' && plain === SCOPE ? SHELL : plain;
  if (OWN.has(key)) e.respondWith(caches.open(CACHE).then(c => c.match(key)).then(hit => hit ?? fetch(req)));
});

// Schriftdateien (gstatic) ändern sich nie: Cache-First. Das Stylesheet:
// Stale-While-Revalidate. Es kommt ohne CORS (opaque), die Dateien mit CORS.
async function font(e, req, url) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  if (cached && url.hostname === 'fonts.gstatic.com') return cached;
  const fresh = fetch(req)
    .then(res => {
      if (res.ok || res.type === 'opaque') e.waitUntil(cache.put(req, res.clone()).catch(() => {}));
      return res;
    })
    .catch(() => Response.error());
  if (cached) e.waitUntil(fresh);
  return cached ?? fresh;
}
