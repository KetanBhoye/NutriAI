import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from './index.js';
import { getConfig } from './config.js';

/**
 * Who wins when a health sync and a person disagree about the same day.
 *
 * The bug: the app force-syncs Apple Health / Health Connect whenever the Plan
 * tab loads. A weigh-in and step count typed by hand were posted, and then
 * immediately overwritten by whatever the phone had — so from the user's side
 * the entry simply never saved. It reproduced only on a phone with real health
 * data, which is why an emulator run and the E2E suite both said it was fine.
 *
 * The rule these tests pin down: **a health sync fills gaps, it never corrects
 * a person.**
 */

let dir: string;
let running: Awaited<ReturnType<typeof createApp>>;

const start = async () => {
  running = await createApp({ ...getConfig(), databasePath: join(dir, 'test.db') });
  return running.app;
};

async function signIn(app: Awaited<ReturnType<typeof start>>): Promise<string> {
  const res = await request(app)
    .post('/api/auth/signup')
    .send({ name: 'Test', email: `t${Date.now()}@example.test`, password: 'Test@1234' });
  const raw = res.headers['set-cookie'];
  return (Array.isArray(raw) ? raw : [raw ?? '']).map((c) => c.split(';')[0]).join('; ');
}

const DATE = '2026-08-16';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nutriai-activity-'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  await running?.close();
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('a health sync versus a hand-typed entry', () => {
  it('keeps the steps a person entered', async () => {
    const app = await start();
    const cookie = await signIn(app);

    await request(app)
      .post('/api/activity')
      .set('Cookie', cookie)
      .send({ activity_date: DATE, steps: 9111, source: 'manual' });

    // The Plan tab loading is enough to trigger this.
    await request(app)
      .post('/api/activity')
      .set('Cookie', cookie)
      .send({ activity_date: DATE, steps: 240, source: 'apple_health' });

    const res = await request(app).get('/api/activity').set('Cookie', cookie);
    expect(res.body.activity.find((a: { activity_date: string }) => a.activity_date === DATE).steps).toBe(9111);
  });

  it('keeps the weigh-in a person entered', async () => {
    const app = await start();
    const cookie = await signIn(app);

    await request(app)
      .post('/api/activity')
      .set('Cookie', cookie)
      .send({ activity_date: DATE, weight_kg: 68.3, source: 'manual' });

    await request(app)
      .post('/api/activity')
      .set('Cookie', cookie)
      .send({ activity_date: DATE, weight_kg: 72.5, source: 'apple_health' });

    const res = await request(app).get('/api/goals').set('Cookie', cookie);
    expect(res.body.latest_weight).toBe(68.3);
  });

  it('still lets health fill a day nobody has touched', async () => {
    // The rule is precedence, not a blockade — most days have no manual entry
    // at all and the phone's numbers are the only ones there are.
    const app = await start();
    const cookie = await signIn(app);

    await request(app)
      .post('/api/activity')
      .set('Cookie', cookie)
      .send({ activity_date: DATE, steps: 7400, weight_kg: 71, source: 'apple_health' });

    const activity = await request(app).get('/api/activity').set('Cookie', cookie);
    const goals = await request(app).get('/api/goals').set('Cookie', cookie);

    expect(activity.body.activity.find((a: { activity_date: string }) => a.activity_date === DATE).steps).toBe(7400);
    expect(goals.body.latest_weight).toBe(71);
  });

  it('still accepts the readings only the phone has', async () => {
    // Active energy and stand hours are never typed by hand, so a manual day
    // must not stop them arriving.
    const app = await start();
    const cookie = await signIn(app);

    await request(app)
      .post('/api/activity')
      .set('Cookie', cookie)
      .send({ activity_date: DATE, steps: 9111, source: 'manual' });

    await request(app)
      .post('/api/activity')
      .set('Cookie', cookie)
      .send({ activity_date: DATE, steps: 240, active_energy_kcal: 512, source: 'apple_health' });

    const res = await request(app).get('/api/activity').set('Cookie', cookie);
    const row = res.body.activity.find((a: { activity_date: string }) => a.activity_date === DATE);
    expect(row.steps).toBe(9111);
    expect(row.active_energy_kcal).toBe(512);
  });

  it('lets a person correct their own entry', async () => {
    const app = await start();
    const cookie = await signIn(app);

    await request(app)
      .post('/api/activity')
      .set('Cookie', cookie)
      .send({ activity_date: DATE, steps: 9111, weight_kg: 68.3, source: 'manual' });

    await request(app)
      .post('/api/activity')
      .set('Cookie', cookie)
      .send({ activity_date: DATE, steps: 12000, weight_kg: 68.9, source: 'manual' });

    const activity = await request(app).get('/api/activity').set('Cookie', cookie);
    const goals = await request(app).get('/api/goals').set('Cookie', cookie);

    expect(activity.body.activity.find((a: { activity_date: string }) => a.activity_date === DATE).steps).toBe(12000);
    expect(goals.body.latest_weight).toBe(68.9);
  });

  it('keeps a hand-logged session against a phone that reports none', async () => {
    const app = await start();
    const cookie = await signIn(app);

    await request(app).post('/api/activity').set('Cookie', cookie).send({
      activity_date: DATE,
      exercise_type: 'treadmill',
      exercise_minutes: 30,
      exercise_kcal: 201,
      steps: 3925,
      source: 'manual',
    });

    await request(app)
      .post('/api/activity')
      .set('Cookie', cookie)
      .send({ activity_date: DATE, steps: 120, source: 'apple_health' });

    const res = await request(app).get('/api/activity').set('Cookie', cookie);
    const row = res.body.activity.find((a: { activity_date: string }) => a.activity_date === DATE);
    expect(row.exercise_type).toBe('treadmill');
    expect(row.exercise_kcal).toBe(201);
    expect(row.steps).toBe(3925);
  });
});
