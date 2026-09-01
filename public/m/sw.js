/**
 * NutriAI PWA service worker.
 *
 * Two jobs, and one deliberate non-job.
 *
 *  1. Make the app launch offline. A standalone home-screen launch with no
 *     network must still open, because the app itself is built to work
 *     offline — reads come from its own cache (src/cache.ts) and writes go
 *     through a durable queue (src/api/queue.ts). Without a service worker
 *     none of that is reachable: the browser can't even fetch index.html, so
 *     the user gets the dinosaur instead of an app that was ready to cope.
 *
 *  2. Make it installable, which needs a worker with a fetch handler.
 *
 * The non-job: API responses are never cached here. That is not an
 * oversight. The app already has a read cache that knows what each resource
 * means — how stale it may be, when to revalidate, what to show while it
 * does — and a write queue that knows what must survive a failed request. A
 * second, dumber cache underneath it would answer requests the app believed
 * went to the server, so a meal logged on the phone could stay invisible on
 * the web until an opaque SW cache expired, and the app's own "last synced"
 * reasoning would be quietly wrong. When the network is down the fetch fails,
 * the app sees a transport error, and its existing offline handling takes
 * over — which is the behaviour the native builds have.
 *
 * BUILD_ID is stamped by scripts/build-web.sh from the exported bundle hash,
 * so a new deploy is a new cache name and the old one is deleted on activate.
 */

const BUILD_ID = '0928c00a92456a6a91963a4b01b38096';
const CACHE = `nutriai-m-${BUILD_ID}`;
const SHELL = '/m/';

// Everything the shell needs before any JS runs. The hashed bundle is not in
// here: its URL changes every build, so it is picked up by the runtime
// cache-first rule below instead of being named at install time.
const PRECACHE = [SHELL, '/m/manifest.webmanifest', '/m/icons/icon-192.png', '/m/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Individually, not addAll: addAll is atomic, so one 404 (an icon that
      // was renamed, say) throws away the entire install and leaves the app
      // with no offline shell at all. A missing icon is not worth that.
      await Promise.all(
        PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {}))
      );
      // Take over as soon as the new build is ready. The alternative is
      // waiting for every tab to close, which on a home-screen app can be
      // days — long enough for a fixed bug to look unfixed.
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name.startsWith('nutriai-m-') && name !== CACHE).map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') void self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Another origin's problem, and the API's answer is the app's to interpret
  // (see the note at the top). Leaving these entirely alone means no fetch
  // handler runs and the request behaves exactly as it would with no worker.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (!url.pathname.startsWith('/m/')) return;

  // A navigation is the app shell whatever the path says — expo-router
  // resolves /m/goals in the browser, so there is no such document to fetch.
  // Network first so a deploy is picked up on the next launch, shell from
  // cache when the network isn't there.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const cache = await caches.open(CACHE);
          void cache.put(SHELL, response.clone());
          return response;
        } catch {
          const cached = await caches.match(SHELL);
          return cached ?? Response.error();
        }
      })()
    );
    return;
  }

  // Build output: hashed filenames, so a cache hit can never be stale — a
  // changed file is a different URL. Cache-first is what makes a warm launch
  // instant and an offline one possible.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        // Opaque and error responses are not worth keeping: caching a 404
        // would pin the failure for the life of the cache.
        if (response.ok && response.type === 'basic') {
          const cache = await caches.open(CACHE);
          void cache.put(request, response.clone());
        }
        return response;
      } catch {
        return Response.error();
      }
    })()
  );
});

/**
 * Reminders (see src/notifications/push.web.ts).
 *
 * The server sends these; drawing them is the worker's job because the tab is
 * usually closed when one arrives — that is the entire reason reminders go
 * through push on the web rather than being scheduled in the app.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // A payload that isn't JSON is still a reminder worth showing — falling
    // through to a silent return would drop it entirely.
    data = { body: event.data ? event.data.text() : '' };
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'NutriAI', {
      body: data.body || '',
      icon: '/m/icons/icon-192.png',
      badge: '/m/icons/icon-192.png',
      // A tag replaces the previous notification with the same one rather than
      // stacking: two evening nudges in a tray is a bug, not twice the nudge.
      tag: data.tag || 'nutriai',
      renotify: true,
      data: { url: data.url || '/m/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/m/';

  event.waitUntil(
    (async () => {
      // Reuse an open tab if there is one — opening a second copy of an app
      // the user already has open loses whatever they were in the middle of.
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).pathname.startsWith('/m/') && 'focus' in client) {
          await client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })()
  );
});
