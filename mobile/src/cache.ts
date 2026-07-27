import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Read-through cache for GET responses.
 *
 * Screens fetch on every mount, so a cold start or a dead connection used to
 * show an empty screen until the network answered. Caching the last good
 * payload lets a screen paint immediately with real data and then quietly
 * replace it once the request lands.
 *
 * Deliberately not a full offline layer: writes still go straight to the
 * server (see progress.md — the durable write queue is a separate,
 * still-deferred piece of work).
 */

const PREFIX = 'nutriai.cache.';

interface Envelope<T> {
  at: number;
  data: T;
}

export async function readCache<T>(key: string, maxAgeMs = Infinity): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const env = JSON.parse(raw) as Envelope<T>;
    if (!env || typeof env.at !== 'number') return null;
    if (Date.now() - env.at > maxAgeMs) return null;
    return env.data;
  } catch {
    return null;
  }
}

export async function writeCache<T>(key: string, data: T): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), data } satisfies Envelope<T>));
  } catch {
    // A cache write failing must never break the screen that triggered it.
  }
}

/** Drops every cached payload — call on sign-out so accounts can't bleed data. */
export async function clearCache(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const ours = keys.filter((k) => k.startsWith(PREFIX));
    if (ours.length) await AsyncStorage.multiRemove(ours);
  } catch {
    // ignore
  }
}

/**
 * Fetches, caching the result. On failure falls back to the cached copy so a
 * flaky connection degrades to stale-but-real data instead of an error screen.
 */
export async function cached<T>(key: string, fetcher: () => Promise<T>): Promise<{ data: T; stale: boolean }> {
  try {
    const data = await fetcher();
    void writeCache(key, data);
    return { data, stale: false };
  } catch (e) {
    const fallback = await readCache<T>(key);
    if (fallback !== null) return { data: fallback, stale: true };
    throw e;
  }
}
