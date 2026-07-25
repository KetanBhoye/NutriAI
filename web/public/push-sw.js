/* global self, clients */
// Imported into the generated Workbox service worker (see vite.config.ts
// workbox.importScripts). Adds Web Push handling on top of the offline cache.

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_e) {
    data = { title: 'NutriAI', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'NutriAI';
  const options = {
    body: data.body || '',
    icon: '/app/icon-192.png',
    badge: '/app/icon-192.png',
    tag: data.tag || 'nutriai',
    renotify: true,
    data: { url: data.url || '/app/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/app/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes('/app') && 'focus' in client) {
          client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      return clients.openWindow(target);
    })
  );
});
