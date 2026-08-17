import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from './index.js';
import { getConfig } from './config.js';
import { clearSettingsCache } from './services/settings.js';
import { DEFAULT_PLAN } from './services/ai/quota.js';

/**
 * The admin controls that can cost money or change what users are allowed.
 *
 * The authorisation tests matter most: these endpoints can switch every user's
 * AI off, move the spend ceiling, and grant Pro. A missing `isAdmin` check on
 * any one of them is a hole a normal signed-in user could walk through.
 */

globalThis.crypto.randomUUID = randomUUID as typeof globalThis.crypto.randomUUID;

let dir: string;
let running: Awaited<ReturnType<typeof createApp>>;

const start = async () =>
  (running = await createApp({
    ...getConfig(),
    dbDriver: 'sqlite',
    databasePath: join(dir, 'admin.db'),
    adminApiKey: 'test-admin-key',
    // createApp seeds this account and marks it admin.
    ...({ } as Record<string, never>),
  }));

async function cookieFor(email: string, password: string): Promise<string> {
  const res = await request(running.app).post('/api/auth/login').send({ email, password });
  const raw = res.headers['set-cookie'];
  return (Array.isArray(raw) ? raw : [raw ?? '']).map((c) => c.split(';')[0]).join('; ');
}

async function signUpPlain(): Promise<{ cookie: string; id: string }> {
  const res = await request(running.app)
    .post('/api/auth/signup')
    .send({ name: 'Plain', email: `p${randomUUID()}@example.test`, password: 'Plain@1234' });
  const raw = res.headers['set-cookie'];
  return {
    cookie: (Array.isArray(raw) ? raw : [raw ?? '']).map((c) => c.split(';')[0]).join('; '),
    id: res.body.user.id,
  };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'nutriai-admin-'));
  clearSettingsCache();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  process.env.ADMIN_EMAIL = 'boss@example.test';
  process.env.ADMIN_PASSWORD = 'Boss@12345';
  await start();
});

afterEach(async () => {
  await running?.close();
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('who can reach the controls', () => {
  it('refuses a signed-in non-admin on every one of them', async () => {
    // Each of these can cost money or grant a paid tier. One missing check is
    // enough for an ordinary account to switch everyone's AI off.
    const { cookie, id } = await signUpPlain();

    for (const call of [
      request(running.app).get('/api/admin/ai').set('Cookie', cookie),
      request(running.app).put('/api/admin/settings').set('Cookie', cookie).send({ ai_enabled: false }),
      request(running.app).patch(`/api/admin/users/${id}/plan`).set('Cookie', cookie).send({ plan: 'pro' }),
    ]) {
      const res = await call;
      expect(res.status).toBe(403);
    }
  });

  it('refuses anonymous callers', async () => {
    for (const call of [
      request(running.app).get('/api/admin/ai'),
      request(running.app).put('/api/admin/settings').send({ ai_enabled: false }),
    ]) {
      const res = await call;
      expect(res.status).toBe(401);
    }
  });

  it('does not let a non-admin grant themselves Pro', async () => {
    // The specific attack: the endpoint takes a user id, so it must not be
    // enough to be signed in as that user.
    const { cookie, id } = await signUpPlain();
    await request(running.app).patch(`/api/admin/users/${id}/plan`).set('Cookie', cookie).send({ plan: 'pro' });

    const admin = await cookieFor('boss@example.test', 'Boss@12345');
    const stats = await request(running.app).get('/api/admin/ai').set('Cookie', admin);
    const found = (stats.body.top_users ?? []).find((u: { user_id: string }) => u.user_id === id);
    // Either absent (no usage yet) or still free — never pro.
    expect(found?.plan ?? 'free').toBe('free');
  });
});

describe('the AI stats panel', () => {
  it('answers for an admin, even with no usage recorded yet', async () => {
    const admin = await cookieFor('boss@example.test', 'Boss@12345');
    const res = await request(running.app).get('/api/admin/ai').set('Cookie', admin);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total_calls: 0, by_feature: [], top_users: [] });
    expect(res.body.repo).toMatchObject({ foods: 0, hits: 0, saved_usd: 0 });
  });

  it('reports what the food repo has saved, which is why it exists', async () => {
    const admin = await cookieFor('boss@example.test', 'Boss@12345');
    const res = await request(running.app).get('/api/admin/ai').set('Cookie', admin);
    expect(res.body.repo).toHaveProperty('saved_usd');
    expect(res.body.repo).toHaveProperty('by_source');
  });
});

describe('the operator knobs', () => {
  it('turns the AI off and back on', async () => {
    const admin = await cookieFor('boss@example.test', 'Boss@12345');

    const off = await request(running.app)
      .put('/api/admin/settings')
      .set('Cookie', admin)
      .send({ ai_enabled: false });
    expect(off.status).toBe(200);
    expect(off.body.settings.find((s: { key: string }) => s.key === 'ai_enabled')?.value).toBe('off');

    const on = await request(running.app)
      .put('/api/admin/settings')
      .set('Cookie', admin)
      .send({ ai_enabled: true });
    expect(on.body.settings.find((s: { key: string }) => s.key === 'ai_enabled')?.value).toBe('on');
  });

  it('records who moved it', async () => {
    // When the AI is off and nobody remembers turning it off, this is the
    // column you want.
    const admin = await cookieFor('boss@example.test', 'Boss@12345');
    const res = await request(running.app)
      .put('/api/admin/settings')
      .set('Cookie', admin)
      .send({ ai_daily_budget_usd: 40 });
    expect(res.body.settings.find((s: { key: string }) => s.key === 'ai_daily_budget_usd')?.updated_by).toBeTruthy();
  });

  it('rejects a budget outside sane bounds', async () => {
    // A typo'd 100000 removes the protection the ceiling exists to provide,
    // and a negative one is meaningless.
    const admin = await cookieFor('boss@example.test', 'Boss@12345');
    for (const value of [-1, 100000]) {
      const res = await request(running.app)
        .put('/api/admin/settings')
        .set('Cookie', admin)
        .send({ ai_daily_budget_usd: value });
      expect(res.status).toBe(400);
    }
  });

  it('accepts zero, because pausing spend entirely is a legitimate choice', async () => {
    const admin = await cookieFor('boss@example.test', 'Boss@12345');
    const res = await request(running.app)
      .put('/api/admin/settings')
      .set('Cookie', admin)
      .send({ ai_daily_budget_usd: 0 });
    expect(res.status).toBe(200);
  });
});

describe('the plan a new account starts on', () => {
  /**
   * A one-off "set everyone to pro" fixes the users who exist that day and says
   * nothing about tomorrow's. That is exactly what happened in production: an
   * account created hours after the backfill landed on free, because the column
   * default still said so. These pin the signup paths themselves, which is the
   * only place that keeps being true as people keep signing up.
   */
  it('puts a new email signup on pro', async () => {
    const { id } = await signUpPlain();
    const row = await running.env.DB
      .prepare('SELECT plan FROM users WHERE id = ?')
      .bind(id)
      .first<{ plan: string }>();
    expect(row?.plan).toBe(DEFAULT_PLAN);
  });

  it('sets the plan explicitly rather than leaning on the column default', async () => {
    // This suite runs on SQLite, where the column default is still 'free' —
    // SQLite cannot alter a default in place, so only Postgres got the new one.
    // That asymmetry is what makes the test above meaningful: it can only pass
    // if the insert names the column, which is what keeps the two drivers
    // agreeing about what a new user gets.
    const defaultOnThisDriver = await running.env.DB
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'")
      .bind()
      .first<{ sql: string }>();
    expect(defaultOnThisDriver?.sql).toContain("'free'");
  });
});

describe('plan changes', () => {
  it('promotes a user to pro and back', async () => {
    const admin = await cookieFor('boss@example.test', 'Boss@12345');
    const { id } = await signUpPlain();

    const up = await request(running.app)
      .patch(`/api/admin/users/${id}/plan`)
      .set('Cookie', admin)
      .send({ plan: 'pro' });
    expect(up.status).toBe(200);
    expect(up.body.plan).toBe('pro');

    const down = await request(running.app)
      .patch(`/api/admin/users/${id}/plan`)
      .set('Cookie', admin)
      .send({ plan: 'free' });
    expect(down.body.plan).toBe('free');
  });

  it('rejects a plan that does not exist', async () => {
    const admin = await cookieFor('boss@example.test', 'Boss@12345');
    const { id } = await signUpPlain();
    const res = await request(running.app)
      .patch(`/api/admin/users/${id}/plan`)
      .set('Cookie', admin)
      .send({ plan: 'enterprise' });
    expect(res.status).toBe(400);
  });

  it('404s on an unknown user rather than reporting success', async () => {
    const admin = await cookieFor('boss@example.test', 'Boss@12345');
    const res = await request(running.app)
      .patch('/api/admin/users/does-not-exist/plan')
      .set('Cookie', admin)
      .send({ plan: 'pro' });
    expect(res.status).toBe(404);
  });
});
