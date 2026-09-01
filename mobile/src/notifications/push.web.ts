import { api, ApiError } from '@/api/client';

/**
 * Web Push, the only way a browser gets a reminder while its tab is closed.
 *
 * This is the same mechanism, the same endpoints and the same server-side
 * sender the Vue app at /app already uses — deliberately, so a user with both
 * open doesn't get two different reminder systems disagreeing about what they
 * are subscribed to. The notification itself is drawn by our service worker's
 * `push` handler (public/sw.js).
 *
 * Not used on native: the phone schedules its own reminders locally, which is
 * strictly better there (no server, no network, exact times). See
 * notifications/reminders.ts.
 */

export type EnableResult = 'enabled' | 'denied' | 'unsupported' | 'unconfigured' | 'error';

/**
 * Whether this browser can do Web Push at all.
 *
 * On iOS the answer is false until the app is installed to the Home Screen —
 * Safari exposes PushManager only to an installed web app — which is why the
 * card's unsupported copy mentions that rather than declaring it impossible.
 */
export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * The subscription — not the permission — is the truth.
 *
 * Permission can be `granted` from a subscription the user later dropped (or
 * one made before the server's key changed), and showing the switch as on in
 * that state promises reminders nobody will send.
 */
export async function pushEnabled(): Promise<boolean> {
  if (!pushSupported()) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    return (await registration.pushManager.getSubscription()) !== null;
  } catch {
    return false;
  }
}

export async function enablePush(): Promise<EnableResult> {
  if (!pushSupported()) return 'unsupported';
  try {
    const { publicKey } = await api<{ publicKey: string | null }>('/api/push/config');
    // A server with no VAPID keys can't send anything; say so rather than
    // asking for a notification permission that would then do nothing.
    if (!publicKey) return 'unconfigured';

    // Asked only once we know the server can actually use it. A permission
    // prompt the user grants for nothing is one they won't grant twice.
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return 'denied';

    const registration = await navigator.serviceWorker.ready;
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        // Required by Chrome: every push must result in a visible
        // notification. We only ever send visible ones anyway.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }));

    // `toJSON()` rather than the object itself: the keys live on a prototype
    // that JSON.stringify would drop, and the server needs them to encrypt.
    await api('/api/push/subscribe', { method: 'POST', body: subscription.toJSON() });
    return 'enabled';
  } catch (e) {
    if (e instanceof ApiError) return 'error';
    // A rejected `requestPermission`, a browser with notifications disabled
    // at the OS level, a subscribe that failed against a changed key — all
    // land here, and none of them are worth telling the user apart.
    return 'error';
  }
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    // Server first: a subscription this browser has forgotten but the server
    // still holds is one that keeps being pushed to until it expires.
    await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: subscription.endpoint } }).catch(
      () => {}
    );
    await subscription.unsubscribe().catch(() => {});
  } catch {
    // Nothing useful to do or say: the switch is already off.
  }
}

/** The real reminder this user would get right now, on demand. */
export async function sendSamplePush(): Promise<void> {
  await api('/api/push/preview-reminder', { method: 'POST' }).catch(() => {});
}

/**
 * VAPID keys travel as base64url; `applicationServerKey` wants raw bytes.
 * atob only speaks standard base64, so the two substitutions and the padding
 * are what stand between the two alphabets.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalised);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
