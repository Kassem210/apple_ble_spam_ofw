// Service worker: offline app shell + push notifications.
const CACHE = 'life-v1';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/voice.js', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Network first so updates show up immediately; cache as the offline fallback.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request).then((r) => r || caches.match('/'))),
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Life', body: event.data?.text() }; }
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: data.tag,
    renotify: Boolean(data.tag),
    data: { url: data.url || '/', taskId: data.taskId },
    actions: data.actions || [],
  };
  event.waitUntil(self.registration.showNotification(data.title || 'Life', options));
});

self.addEventListener('notificationclick', (event) => {
  const { url, taskId } = event.notification.data || {};
  event.notification.close();
  if (taskId && (event.action === 'done' || event.action === 'snooze')) {
    const endpoint = event.action === 'done' ? `/api/tasks/${taskId}/done` : `/api/tasks/${taskId}/snooze`;
    event.waitUntil(fetch(endpoint, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes: 15 }),
    }));
    return;
  }
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if (new URL(client.url).origin === location.origin) {
        await client.focus();
        client.postMessage({ type: 'open', url });
        return;
      }
    }
    await self.clients.openWindow(url || '/');
  })());
});
