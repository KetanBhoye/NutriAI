import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from './index.js';
import { getConfig } from './config.js';

/**
 * `/download` is the link handed to people installing the Android build, so it
 * has to keep working long after it's been shared — including across app
 * versions and a move off GitHub. It redirects rather than serving 86 MB from
 * the deployment image.
 */

let dir: string;
let running: Awaited<ReturnType<typeof createApp>>;

const start = async () => {
  running = await createApp({ ...getConfig(), databasePath: join(dir, 'test.db') });
  return running.app;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nutriai-download-'));
  delete process.env.APK_DOWNLOAD_URL;
});

afterEach(async () => {
  await running?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('GET /download', () => {
  it('redirects to the latest release rather than serving the file', async () => {
    const res = await request(await start()).get('/download');

    expect(res.status).toBe(302);
    // The "latest" permalink, so publishing a release is all it takes to
    // change what this link hands out — no redeploy.
    expect(res.headers.location).toBe(
      'https://github.com/KetanBhoye/NutriAI/releases/latest/download/NutriAI.apk'
    );
  });

  it('can be pointed anywhere, so the link outlives GitHub', async () => {
    process.env.APK_DOWNLOAD_URL = 'https://cdn.example.com/builds/NutriAI.apk';

    const res = await request(await start()).get('/download');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://cdn.example.com/builds/NutriAI.apk');
  });

  it('needs no session — the people installing it do not have accounts yet', async () => {
    const res = await request(await start()).get('/download');
    expect(res.status).not.toBe(401);
  });
});
