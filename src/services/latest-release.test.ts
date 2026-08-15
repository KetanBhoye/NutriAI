import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLatestRelease, resetLatestReleaseCache, versionFromTag } from './latest-release.js';

/**
 * The app's update prompt is driven entirely by this. Getting it wrong is
 * asymmetric: a missed update is a nuisance, but offering an update that
 * doesn't exist sends every phone to a 404 download.
 */

const release = (over: Record<string, unknown> = {}) => ({
  tag_name: 'v1.0.1',
  body: 'Fixes the exercise minutes.\n',
  draft: false,
  prerelease: false,
  published_at: '2026-08-01T10:00:00Z',
  assets: [{ name: 'NutriAI.apk', size: 90_000_000 }],
  ...over,
});

const respondWith = (body: unknown, ok = true, status = 200, etag?: string) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok,
      status,
      json: async () => body,
      headers: { get: (h: string) => (h.toLowerCase() === 'etag' ? (etag ?? null) : null) },
    }) as unknown as Response)
  );

/** The headers of the most recent request. */
const sentHeaders = (): Record<string, string> =>
  ((globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[1] as {
    headers: Record<string, string>;
  }).headers;

beforeEach(() => {
  resetLatestReleaseCache();
  delete process.env.GITHUB_RELEASES_REPO;
  // The warning on the failure paths is expected output, not a problem.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('versionFromTag', () => {
  it('strips the leading v', () => {
    expect(versionFromTag('v1.2.3')).toBe('1.2.3');
    expect(versionFromTag('1.2.3')).toBe('1.2.3');
  });

  it('rejects anything that is not a three-part version', () => {
    // Tags like `backend-2026-08` or `v2` would otherwise be compared as
    // versions and produce nonsense.
    expect(versionFromTag('v1.2')).toBeNull();
    expect(versionFromTag('backend-2026-08')).toBeNull();
    expect(versionFromTag(undefined)).toBeNull();
  });
});

describe('getLatestRelease', () => {
  it('reports the published version, notes and size', async () => {
    respondWith(release());

    expect(await getLatestRelease()).toEqual({
      version: '1.0.1',
      notes: 'Fixes the exercise minutes.',
      size_bytes: 90_000_000,
      published_at: '2026-08-01T10:00:00Z',
    });
  });

  it('ignores a release with no APK attached', async () => {
    // The GitHub UI attaches source archives to every release. Treating one of
    // those as installable would offer an update that cannot be downloaded.
    respondWith(release({ assets: [{ name: 'Source code (zip)', size: 120 }] }));

    expect(await getLatestRelease()).toBeNull();
  });

  it('ignores drafts and prereleases', async () => {
    respondWith(release({ draft: true }));
    expect(await getLatestRelease()).toBeNull();

    resetLatestReleaseCache();
    respondWith(release({ prerelease: true }));
    expect(await getLatestRelease()).toBeNull();
  });

  it('caches, so a phone per user does not exhaust GitHub rate limits', async () => {
    respondWith(release());

    await getLatestRelease();
    await getLatestRelease();
    await getLatestRelease();

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps serving the last good answer when GitHub fails', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    respondWith(release());
    await getLatestRelease();

    // Rate limited on the next refresh, an hour later.
    clock.mockReturnValue(1_000_000 + 60 * 60 * 1000);
    respondWith(null, false, 403);

    // Still the real version — a GitHub blip must not silently tell every
    // phone it is up to date.
    expect(await getLatestRelease()).toMatchObject({ version: '1.0.1' });
  });

  it('asks conditionally once it has an ETag, which GitHub does not charge for', async () => {
    // The whole point: a 304 costs no rate limit, and this server shares an
    // egress IP with every other tenant on the platform.
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    respondWith(release(), true, 200, 'W/"abc"');
    await getLatestRelease();

    clock.mockReturnValue(1_000_000 + 11 * 60 * 1000);
    respondWith(null, true, 304);
    expect(await getLatestRelease()).toMatchObject({ version: '1.0.1' });

    expect(sentHeaders()['If-None-Match']).toBe('W/"abc"');
  });

  it('retries a failure within a minute instead of sitting on it for ten', async () => {
    // A rate-limited response cached for the full TTL tells every phone that
    // checks in that window "you're up to date" — a silent outage of the
    // update mechanism, which is exactly how one went unnoticed in production.
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    respondWith(null, false, 403);
    expect(await getLatestRelease()).toBeNull();

    clock.mockReturnValue(1_000_000 + 61 * 1000);
    respondWith(release());
    expect(await getLatestRelease()).toMatchObject({ version: '1.0.1' });
  });

  it('does not send a stale ETag after a failure, which would mask a real answer', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    respondWith(null, false, 403);
    await getLatestRelease();

    clock.mockReturnValue(1_000_000 + 61 * 1000);
    respondWith(release());
    await getLatestRelease();

    expect(sentHeaders()['If-None-Match']).toBeUndefined();
  });

  it('returns null rather than throwing when GitHub is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('getaddrinfo ENOTFOUND');
      })
    );

    await expect(getLatestRelease()).resolves.toBeNull();
  });
});
