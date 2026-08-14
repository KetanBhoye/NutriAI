import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkForUpdate, currentVersion } from './index';

/**
 * The update check as the UI sees it. Platform is pinned to Android per-file —
 * the shared test setup runs as iOS, where updates are correctly impossible.
 */
vi.mock('react-native', () => ({
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
}));

vi.mock('expo-constants', () => ({
  default: { expoConfig: { version: '1.0.0', extra: { apiUrl: 'https://example.test' } } },
}));

// `vi.hoisted` so the mock factory can close over this — plain `const` would
// still be in its temporal dead zone when the hoisted `vi.mock` runs.
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../api', () => ({ api }));

const serverSays = (over: Record<string, unknown> = {}) =>
  api.mockResolvedValue({
    version: '1.0.1',
    notes: 'Health sync fix.',
    size_bytes: 90_000_000,
    published_at: '2026-08-01T10:00:00Z',
    url: 'https://nutriai-app.up.railway.app/download',
    ...over,
  });

beforeEach(() => {
  api.mockReset();
});

describe('currentVersion', () => {
  it('reads the version the installed package reports to Android', () => {
    // From expo-application (see the shared setup's stub), not from
    // app.config.ts — that's the number Android itself compares on install.
    expect(currentVersion()).toBe('1.0.0');
  });
});

describe('checkForUpdate', () => {
  it('offers a newer published build', async () => {
    serverSays();

    expect(await checkForUpdate()).toEqual({
      currentVersion: '1.0.0',
      latestVersion: '1.0.1',
      available: true,
      notes: 'Health sync fix.',
      sizeLabel: '86 MB',
      url: 'https://nutriai-app.up.railway.app/download',
    });
  });

  it('reports no update when the running build is current', async () => {
    serverSays({ version: '1.0.0' });

    expect(await checkForUpdate()).toMatchObject({ available: false, latestVersion: '1.0.0' });
  });

  it('treats "no release published" as nothing to do, not an error', async () => {
    serverSays({ version: null, notes: '', size_bytes: null });

    const result = await checkForUpdate();

    expect(result.available).toBe(false);
    expect(result.sizeLabel).toBeNull();
  });

  it('lets a real network failure surface, since the user pressed a button', async () => {
    api.mockRejectedValue(new Error('Network request failed'));

    await expect(checkForUpdate()).rejects.toThrow('Network request failed');
  });

  it('asks the server, not GitHub', async () => {
    serverSays();
    await checkForUpdate();

    // Going straight to GitHub would couple every installed app to it, and to
    // its unauthenticated rate limit.
    expect(api).toHaveBeenCalledWith('/api/app-version');
  });
});
