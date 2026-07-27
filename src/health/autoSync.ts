import AsyncStorage from '@react-native-async-storage/async-storage';
import { health } from './index';
import { syncToday } from './sync';

/**
 * Background health sync.
 *
 * Runs on launch and whenever the app returns to the foreground, so steps and
 * weight reach the backend without the user opening the You tab and tapping
 * "Sync now". Deliberately quiet: it never prompts for permission (that stays
 * an explicit action in the You tab) and never surfaces errors, because a
 * failed sync must not interrupt whatever the user is actually doing.
 */

const LAST_SYNC_KEY = 'nutriai.health.lastAutoSync';
/** Don't re-sync more often than this; foregrounding can fire in bursts. */
const MIN_INTERVAL_MS = 15 * 60 * 1000;

let inFlight = false;

async function shouldSync(now: number): Promise<boolean> {
  const raw = await AsyncStorage.getItem(LAST_SYNC_KEY);
  if (!raw) return true;
  const last = Number(raw);
  return !Number.isFinite(last) || now - last >= MIN_INTERVAL_MS;
}

export interface AutoSyncResult {
  synced: boolean;
  reason?: 'throttled' | 'unavailable' | 'no-permission' | 'in-flight' | 'failed';
}

/**
 * @param force Skip the throttle (used by the manual "Sync now" button).
 */
export async function autoSyncHealth(force = false): Promise<AutoSyncResult> {
  if (inFlight) return { synced: false, reason: 'in-flight' };

  const now = Date.now();
  if (!force && !(await shouldSync(now))) return { synced: false, reason: 'throttled' };

  inFlight = true;
  try {
    if (!(await health.isAvailable())) return { synced: false, reason: 'unavailable' };

    // Only sync once the user has already granted access — requesting here
    // would pop a permission sheet over an unrelated screen.
    const granted = await health.requestPermissions().catch(() => false);
    if (!granted) return { synced: false, reason: 'no-permission' };

    const { posted } = await syncToday();
    await AsyncStorage.setItem(LAST_SYNC_KEY, String(now));
    return { synced: posted };
  } catch {
    return { synced: false, reason: 'failed' };
  } finally {
    inFlight = false;
  }
}
