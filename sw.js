const CACHE = 'cargo-reminder-cf-v5';
const scopeUrl = self.registration.scope;
const assetUrl = path => new URL(path, scopeUrl).href;
const ASSETS = ['', 'index.html', 'app.js', 'styles.css', 'manifest.webmanifest', 'icon.svg'].map(assetUrl);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))),
    self.clients.claim()
  ]));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});

function appUrl(path = './') {
  const relative = path.startsWith('/') ? path.slice(1) : path;
  return new URL(relative || './', scopeUrl).href;
}

self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(data.title || '货运行程提醒', {
    body: data.body || '有一条行程需要报备',
    icon: assetUrl('icon.svg'),
    tag: data.tag || 'cargo-reminder',
    data: { url: data.url || './' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = appUrl(event.notification.data?.url || './');
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const client of list) {
      if ('navigate' in client) client.navigate(target);
      if ('focus' in client) return client.focus();
    }
    return self.clients.openWindow(target);
  }));
});
