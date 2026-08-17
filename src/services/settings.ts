import type { D1DatabaseCompat } from '../db/types.js';
import { sqlTimestampNow } from '../db/time.js';

/**
 * Operator knobs the admin dashboard can turn without a deploy.
 *
 * The two that matter are the AI budget ceiling and the kill switch, and both
 * are things you reach for while something is actively going wrong. As
 * environment variables they needed a redeploy — several more minutes of
 * spending, at the exact moment you wanted it to stop.
 *
 * Cached for a few seconds because the quota check runs on every AI request and
 * must not add a query. The TTL is the worst-case delay between flipping the
 * switch and it taking effect, which is why it is seconds rather than minutes.
 */

const TTL_MS = 5000;

let cache: { at: number; values: Map<string, string> } | null = null;

export const SETTINGS = {
  /** 'on' | 'off'. Off degrades every AI feature to its rule-based fallback. */
  AI_ENABLED: 'ai_enabled',
  /** Project-wide rolling-24h ceiling in USD. */
  AI_DAILY_BUDGET_USD: 'ai_daily_budget_usd',
} as const;

/** Invalidate after a write, so the admin sees their own change immediately. */
export function clearSettingsCache(): void {
  cache = null;
}

async function load(db: D1DatabaseCompat): Promise<Map<string, string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.values;

  const values = new Map<string, string>();
  try {
    const rows = await db.prepare('SELECT key, value FROM app_settings').bind().all<{
      key: string;
      value: string;
    }>();
    for (const row of rows.results ?? []) values.set(row.key, row.value);
  } catch {
    // Before the migration lands. Callers fall back to their defaults rather
    // than the request failing — a missing settings table must not take the
    // app down.
  }

  cache = { at: Date.now(), values };
  return values;
}

export async function getSetting(
  db: D1DatabaseCompat,
  key: string,
  fallback: string
): Promise<string> {
  const values = await load(db);
  return values.get(key) ?? fallback;
}

export async function getNumberSetting(
  db: D1DatabaseCompat,
  key: string,
  fallback: number
): Promise<number> {
  const raw = await getSetting(db, key, String(fallback));
  const parsed = Number(raw);
  // A malformed value must not disable the ceiling it was meant to set.
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function setSetting(
  db: D1DatabaseCompat,
  key: string,
  value: string,
  updatedBy: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at, updated_by)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE
         SET value = excluded.value, updated_at = excluded.updated_at,
             updated_by = excluded.updated_by`
    )
    .bind(key, value, sqlTimestampNow(), updatedBy)
    .run();
  clearSettingsCache();
}

export interface SettingRow {
  key: string;
  value: string;
  updated_at: string;
  updated_by: string | null;
}

export async function allSettings(db: D1DatabaseCompat): Promise<SettingRow[]> {
  try {
    const rows = await db
      .prepare('SELECT key, value, updated_at, updated_by FROM app_settings ORDER BY key')
      .bind()
      .all<SettingRow>();
    return rows.results ?? [];
  } catch {
    return [];
  }
}
