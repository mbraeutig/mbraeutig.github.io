// Minamo-Probe: nimmt das Teilen-Ziel (POST, multipart/form-data) an – so wie es Schritt 33 für Minamo plant.
// Mit Datei: in den Cache legen und auf ./?geteilt weiterleiten. Ohne Datei: auf ./?title=…&text=…&url=… weiterleiten.
// Sonst nichts (kein Offline-Start); Scope /minamo-probe/, Minamos eigener Service Worker bleibt unberührt.
const SHARE_CACHE = 'minamo-probe-share';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname.endsWith('/teilen')) event.respondWith(receive(event.request));
});

async function receive(request) {
  const form = await request.formData();
  const fields = { title: form.get('title') || '', text: form.get('text') || '', url: form.get('url') || '' };
  // Ein leeres Dateifeld (Name leer, 0 Byte) ist keine Datei – sonst würde geteilter Text zur leeren Aufnahme.
  const files = form.getAll('audio').filter((f) => typeof f !== 'string' && f.size > 0);
  if (files.length) {
    const file = files[0];
    const cache = await caches.open(SHARE_CACHE);
    await cache.put(new URL('geteilt', self.registration.scope), new Response(file, {
      headers: {
        'content-type': file.type || 'application/octet-stream',
        'x-type': file.type || '',
        'x-name': encodeURIComponent(file.name || ''),
        'x-fields': encodeURIComponent(JSON.stringify(fields)),
        'x-count': String(files.length),
      },
    }));
    return Response.redirect(new URL('./?geteilt', self.registration.scope).href, 303);
  }
  const query = new URLSearchParams(Object.entries(fields).filter(([, v]) => v)).toString();
  return Response.redirect(new URL('./?' + query, self.registration.scope).href, 303);
}
