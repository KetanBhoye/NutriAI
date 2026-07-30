import { afterEach, describe, expect, it, vi } from 'vitest';
import { cached, clearCache, readCache, writeCache } from './cache';
import { memoryStorage } from './test/setup';

afterEach(() => {
  vi.useRealTimers();
});

describe('writeCache / readCache', () => {
  it('round-trips a payload', async () => {
    await writeCache('goals', { calories: 1900 });
    expect(await readCache('goals')).toEqual({ calories: 1900 });
  });

  it('returns null for a key that was never written', async () => {
    expect(await readCache('nothing')).toBeNull();
  });

  it('honours a max age', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 17, 9, 0));
    await writeCache('goals', { calories: 1900 });

    vi.setSystemTime(new Date(2026, 6, 17, 9, 30));
    expect(await readCache('goals', 60 * 60_000)).toEqual({ calories: 1900 });
    expect(await readCache('goals', 10 * 60_000)).toBeNull();
  });

  it('survives corrupt stored JSON', async () => {
    // A half-written value must degrade to "no cache", not crash the screen.
    memoryStorage.set('nutriai.cache.goals', '{not json');
    expect(await readCache('goals')).toBeNull();
  });

  it('rejects an envelope without a timestamp', async () => {
    memoryStorage.set('nutriai.cache.goals', JSON.stringify({ data: { calories: 1 } }));
    expect(await readCache('goals')).toBeNull();
  });
});

describe('cached', () => {
  it('returns fresh data and stores it', async () => {
    const res = await cached('goals', async () => ({ calories: 1900 }));

    expect(res).toEqual({ data: { calories: 1900 }, stale: false });
    expect(await readCache('goals')).toEqual({ calories: 1900 });
  });

  it('falls back to the last good payload when the request fails', async () => {
    await writeCache('goals', { calories: 1800 });

    const res = await cached('goals', async () => {
      throw new Error('offline');
    });

    // Stale, and flagged as such — screens show a notice rather than passing
    // old numbers off as current.
    expect(res).toEqual({ data: { calories: 1800 }, stale: true });
  });

  it('rethrows when there is nothing cached to fall back on', async () => {
    await expect(
      cached('goals', async () => {
        throw new Error('offline');
      })
    ).rejects.toThrow('offline');
  });

  it('does not overwrite a good cache with a failed fetch', async () => {
    await writeCache('goals', { calories: 1800 });
    await cached('goals', async () => {
      throw new Error('offline');
    });
    expect(await readCache('goals')).toEqual({ calories: 1800 });
  });
});

describe('clearCache', () => {
  it('drops every cached payload on sign-out', async () => {
    await writeCache('goals', { calories: 1900 });
    await writeCache('entries.2026-07-17', { entries: [] });

    await clearCache();

    expect(await readCache('goals')).toBeNull();
    expect(await readCache('entries.2026-07-17')).toBeNull();
  });

  it('leaves other stored keys alone', async () => {
    // The session cookie and the pending write queue must survive; only cached
    // *reads* belong to the account that just signed out.
    memoryStorage.set('nutriai.pending.v2', '[]');
    await writeCache('goals', { calories: 1900 });

    await clearCache();

    expect(memoryStorage.get('nutriai.pending.v2')).toBe('[]');
  });
});
