import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from './index.js';
import { getConfig } from './config.js';
import { resetLatestReleaseCache } from './services/latest-release.js';

/**
 * The app's in-app updater reads this. See src/services/latest-release.ts for
 * why it reports a version string rather than Android's versionCode.
 */

let dir: string;
let running: Awaited<ReturnType<typeof createApp>>;

const start = async () => {
  running = await createApp({ ...getConfig(), databasePath: join(dir, 'test.db') });
  return running.app;
};

const stubGithub = (body: unknown, ok = true) =>
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body }) as unknown as Response));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nutriai-appversion-'));
  resetLatestReleaseCache();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  await running?.close();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /api/app-version', () => {
  it('reports the latest release and points downloads back through /download', async () => {
    stubGithub({
      tag_name: 'v1.0.1',
      body: 'Health sync reads exercise time in minutes.',
      published_at: '2026-08-01T10:00:00Z',
      assets: [{ name: 'NutriAI.apk', size: 90_000_000 }],
    });

    const res = await request(await start()).get('/api/app-version');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      version: '1.0.1',
      notes: 'Health sync reads exercise time in minutes.',
      size_bytes: 90_000_000,
    });
    // Not the GitHub asset: /download stays the one place that decides where
    // APKs come from, so APK_DOWNLOAD_URL moves installed apps too.
    expect(res.body.url).toMatch(/\/download$/);
  });

  it('needs no session — an app too old to sign in still has to be updatable', async () => {
    stubGithub({ tag_name: 'v1.0.1', assets: [{ name: 'NutriAI.apk', size: 1 }] });

    const res = await request(await start()).get('/api/app-version');

    expect(res.status).toBe(200);
  });

  it('answers with a null version when GitHub is down, rather than failing', async () => {
    stubGithub(null, false);

    const res = await request(await start()).get('/api/app-version');

    // The app reads this as "nothing to install" and stays quiet. A 500 here
    // would surface an error for something the user never asked for.
    expect(res.status).toBe(200);
    expect(res.body.version).toBeNull();
  });
});
