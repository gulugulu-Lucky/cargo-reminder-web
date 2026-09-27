const CACHE = 'cargo-reminder-v18-badge-preview';
const BADGE_STATE_CACHE = 'cargo-badge-state-v1';
const scopeUrl = self.registration.scope;
const assetUrl = path => new URL(path, scopeUrl).href;
const ASSETS = ['', 'index.html', 'manifest.webmanifest', 'icon.svg'].map(assetUrl);
const BADGE_STATE_URL = assetUrl('__cargo_badge_state__.json');

function reminderDateKey(trip) {
  const [y, m, d] = String(trip?.eta_date || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  const days = Math.max(0, Math.floor(Number(trip?.remind_days_before ?? 1) || 0));
  return new Date(Date.UTC(y, m - 1, d - days, 12, 0, 0)).toISOString().slice(0, 10);
}

function shanghaiDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const part = type => parts.find(x => x.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function pendingBadgeCount(trips) {
  const today = shanghaiDateKey();
  return (Array.isArray(trips) ? trips : []).filter(trip => {
    if (trip?.status === '已报备') return false;
    const dueDate = reminderDateKey(trip);
    return dueDate && dueDate <= today;
  }).length;
}

async function applyBadgeCount(count) {
  if (!('setAppBadge' in self.registration)) return;
  if (count > 0) {
    await self.registration.setAppBadge(count);
  } else if ('clearAppBadge' in self.registration) {
    await self.registration.clearAppBadge();
  } else {
    await self.registration.setAppBadge(0);
  }
}

async function saveBadgeState(trips) {
  const safeTrips = Array.isArray(trips) ? trips.slice(0, 200) : [];
  const cache = await caches.open(BADGE_STATE_CACHE);
  await cache.put(BADGE_STATE_URL, new Response(JSON.stringify({ trips: safeTrips }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  }));
  await applyBadgeCount(pendingBadgeCount(safeTrips));
}

async function refreshBadgeFromStoredState() {
  const cache = await caches.open(BADGE_STATE_CACHE);
  const response = await cache.match(BADGE_STATE_URL);
  if (!response) return;
  try {
    const state = await response.json();
    await applyBadgeCount(pendingBadgeCount(state?.trips));
  } catch {}
}

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE && k !== BADGE_STATE_CACHE).map(k => caches.delete(k))
    )),
    self.clients.claim(),
    refreshBadgeFromStoredState()
  ]));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (event.request.method === 'POST' && url.origin === self.location.origin && url.pathname === '/api/sync-all') {
    const copy = event.request.clone();
    event.waitUntil(copy.json().then(body => saveBadgeState(body?.trips)).catch(() => {}));
    return;
  }

  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});

function appUrl(path = './') {
  const relative = path.startsWith('/') ? path.slice(1) : path;
  return new URL(relative || './', scopeUrl).href;
}

self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(Promise.all([
    self.registration.showNotification(data.title || '行程提醒', {
      body: data.body || '有一条行程需要报备',
      icon: assetUrl('icon.svg'),
      tag: data.tag || 'cargo-reminder',
      data: { url: data.url || './' }
    }),
    refreshBadgeFromStoredState()
  ]));
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
