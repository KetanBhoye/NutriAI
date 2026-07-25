import webpush from 'web-push';
import type { D1DatabaseCompat } from '../db/types.js';

/**
 * Web Push (VAPID) delivery.
 *
 * Configured entirely from env so the feature is a deployment choice:
 *   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY   generated with web-push
 *   VAPID_SUBJECT                          a mailto: or https: contact URL
 *
 * When the keys are absent the feature is simply "off": the client hides the
 * toggle and the endpoints report unconfigured, so nothing breaks.
 */

let configured: boolean | null = null;

function ensureConfigured(): boolean {
  if (configured !== null) return configured;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    configured = false;
    return false;
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:notifications@nutriai.app',
    publicKey,
    privateKey
  );
  configured = true;
  return true;
}

export function isPushConfigured(): boolean {
  return ensureConfigured();
}

export function pushPublicKey(): string | null {
  return isPushConfigured() ? process.env.VAPID_PUBLIC_KEY! : null;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function saveSubscription(
  db: D1DatabaseCompat,
  userId: string,
  sub: PushSubscriptionInput
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth`
    )
    .bind(sub.endpoint, userId, sub.keys.p256dh, sub.keys.auth)
    .run();
}

export async function removeSubscription(db: D1DatabaseCompat, endpoint: string): Promise<void> {
  await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run();
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/**
 * Sends a notification to every device a user has subscribed. Endpoints that
 * the push service reports as gone (404/410) are pruned, so a stale device
 * doesn't accumulate failures forever. Returns how many were delivered.
 */
export async function sendPushToUser(
  db: D1DatabaseCompat,
  userId: string,
  payload: PushPayload
): Promise<number> {
  if (!ensureConfigured()) return 0;

  const rows = await db
    .prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?')
    .bind(userId)
    .all<{ endpoint: string; p256dh: string; auth: string }>();

  const subs = rows.results ?? [];
  let delivered = 0;

  await Promise.all(
    subs.map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          JSON.stringify(payload),
          { TTL: 60 * 60 * 12 }
        );
        delivered += 1;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await removeSubscription(db, row.endpoint).catch(() => {});
        } else {
          console.error('Push send failed:', status ?? '', (error as Error).message);
        }
      }
    })
  );

  return delivered;
}

/** All users who currently have at least one push subscription. */
export async function subscribedUserIds(db: D1DatabaseCompat): Promise<string[]> {
  const rows = await db
    .prepare('SELECT DISTINCT user_id FROM push_subscriptions')
    .all<{ user_id: string }>();
  return (rows.results ?? []).map((r) => r.user_id);
}
