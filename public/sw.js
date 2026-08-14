/**
 * RunButter service worker.
 *
 * TWO JOBS, AND CACHING IS NOT ONE OF THEM.
 *
 * A service worker is required for installability and for push, so this exists
 * to do those two things. It deliberately does NOT cache app shells or assets:
 * Next.js already fingerprints and cache-controls its bundles, and a hand-rolled
 * cache in front of a deployed-hourly app is the classic way to serve somebody
 * last week's JavaScript against this week's API until they clear site data. If
 * offline support is wanted later it should be a deliberate, versioned design,
 * not a fetch handler bolted on here.
 *
 * There is no `fetch` listener at all, which also means this worker adds zero
 * latency to every request in the app.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }

  const title = payload.title || 'RunButter';
  const options = {
    body: payload.body || '',
    icon: '/android-chrome-192x192.png',
    badge: '/android-chrome-192x192.png',
    // Same tag collapses repeats: five overdue invoices should be one line in
    // the shade, not five.
    tag: payload.tag || 'runbutter',
    data: { url: payload.url || '/home' },
    timestamp: Date.now(),
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/home';
  // Focus an open tab rather than opening a second one — a notification that
  // spawns a duplicate window every time is its own annoyance.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) { client.navigate(url); return client.focus(); }
      }
      return self.clients.openWindow(url);
    })
  );
});
