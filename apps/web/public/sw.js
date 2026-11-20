/* The build supplies the hashed frontend assets before this script. Private API
 * responses and media use their own account-scoped store in the page. */
self.addEventListener('install', event => {
  event.waitUntil(caches.open(shell.name).then(cache => cache.addAll(shell.files)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('matro-shell-') && key !== shell.name).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/index.html')) {
    event.respondWith(fetch(request).then(response => {
      if (response.status >= 500) throw new Error('Matro server unavailable');
      return response;
    }).catch(() => caches.open(shell.name).then(cache => cache.match('/'))));
  } else if (shell.files.includes(url.pathname)) {
    event.respondWith(caches.open(shell.name).then(cache => cache.match(url.pathname)).then(hit => hit || fetch(request)));
  }
});
