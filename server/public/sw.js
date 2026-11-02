// Keeps the app itself and posters on the device so a saved title can be opened and played with no connection.
// The downloaded video is not stored here: it lives in IndexedDB (web/offline.js) and is played from a blob.
const SHELL = 'matro-shell-v1', ART = 'matro-art-v1';
const keep = new Set([SHELL, ART]);

self.addEventListener('install', event => { event.waitUntil(caches.open(SHELL).then(cache => cache.add('/')).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(names => Promise.all(names.filter(name => !keep.has(name)).map(name => caches.delete(name)))).then(() => self.clients.claim()));
});

// The network wins while it works, so a deploy is picked up at once; the copy is only the fallback.
async function networkFirst(request, cacheName, ignoreSearch) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch });
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('fetch', event => {
  const { request } = event, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin || request.headers.has('range')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => { if (response.ok) caches.open(SHELL).then(cache => cache.put('/', response.clone())); return response; })
      .catch(async () => (await caches.match('/')) || Response.error()));
    return;
  }
  if (url.pathname.startsWith('/api/artwork/')) return void event.respondWith(networkFirst(request, ART, false));
  if (url.pathname.startsWith('/api/')) return;
  event.respondWith(networkFirst(request, SHELL, true));
});
