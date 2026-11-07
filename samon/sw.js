// Samon – Service Worker (KONZEPT.md §10). Einzige Aufgabe: offline laufen.
//
// Eigene Dateien: Cache-First aus einem versionierten Cache. VERSION setzt
// publish.mjs beim Veröffentlichen auf einen Hash über alle Dateien. Jede Änderung
// ergibt so eine neue sw.js, der Browser installiert sie im Hintergrund, und ab
// dem nächsten Start der App ist die neue Version aktiv.
// Beim lokalen Entwickeln (VERSION 'dev') gilt Network-First, damit Änderungen
// sofort sichtbar sind und der Cache nur offline einspringt.
//
// Schriften von Google: Stale-While-Revalidate in einem eigenen Cache.
//
// Samon teilt sich den Origin (mbraeutig.github.io) mit anderen Apps samt deren
// Caches. Aufgeräumt werden deshalb nur eigene Caches mit Präfix „samon-“.

const VERSION = '50eaaf3274';
const CACHE = `samon-${VERSION}`;
const FONTS = 'samon-fonts';

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
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', e => {
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
        .filter(k => k.startsWith('samon-') && k !== CACHE && k !== FONTS)
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isFont = url => url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (isFont(url)) e.respondWith(staleWhileRevalidate(e, req));
  else if (url.origin === self.location.origin) e.respondWith(own(req));
});

// Jede Navigation innerhalb von Samon ist dieselbe eine Seite.
async function own(req) {
  const cache = await caches.open(CACHE);
  const key = req.mode === 'navigate' ? './index.html' : req;
  if (VERSION === 'dev') {
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(key, res.clone());
      return res;
    } catch {
      return (await cache.match(key, { ignoreSearch: true })) ?? Response.error();
    }
  }
  return (await cache.match(key, { ignoreSearch: true })) ?? fetch(req);
}

async function staleWhileRevalidate(e, req) {
  const cache = await caches.open(FONTS);
  const cached = await cache.match(req);
  // Das Stylesheet kommt ohne CORS (opaque), die Schriftdateien mit CORS.
  const fresh = fetch(req)
    .then(res => {
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    })
    .catch(() => cached ?? Response.error());
  if (cached) {
    e.waitUntil(fresh);
    return cached;
  }
  return fresh;
}
