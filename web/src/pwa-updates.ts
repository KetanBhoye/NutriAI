/**
 * Keeps the installed PWA fresh without a reinstall.
 *
 * vite-plugin-pwa runs in `autoUpdate` mode, so a newly-installed service worker
 * skips waiting and claims clients immediately. The missing piece is *checking*
 * for that new worker: an installed iOS PWA only checks on a full relaunch, so if
 * you just background/foreground it, you never get the update. Here we force a
 * `registration.update()` whenever the app returns to the foreground (plus
 * hourly), and reload once the new worker takes control.
 */
export function setupPwaAutoUpdate(): void {
  if (!('serviceWorker' in navigator)) return;

  // Reload when a NEW worker takes control — but not on the very first install
  // (no prior controller), which would reload uselessly on first open.
  let refreshing = false;
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing || !hadController) return;
    refreshing = true;
    window.location.reload();
  });

  navigator.serviceWorker.ready
    .then((registration) => {
      const check = () => registration.update().catch(() => undefined);

      // Foreground return is the key trigger for installed iOS PWAs.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      window.addEventListener('focus', check);
      // And a slow heartbeat while the app stays open.
      setInterval(check, 60 * 60 * 1000);
      check();
    })
    .catch(() => undefined);
}
