import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from './index.js';
import { getConfig } from './config.js';

/**
 * The payload behind the shared card.
 *
 * This suite exists because of a production outage that no existing test could
 * have caught: the endpoint selected `daily_step_goal` from
 * `user_tracking_preferences`, where that column does not live — it is on
 * `goal_plans`. TypeScript is happy, every unit test is happy, and the query
 * throws at runtime on every share, for every user. The app's only symptom was
 * "Couldn't build your card."
 *
 * The lesson is narrow and worth keeping: a hand-written SQL column list is
 * only checked by executing it against a real schema. So these tests hit the
 * route rather than the functions behind it, and the first one would fail on
 * any column name that does not exist.
 */

globalThis.crypto.randomUUID = randomUUID as typeof globalThis.crypto.randomUUID;

let dir: string;
let running: Awaited<ReturnType<typeof createApp>>;

const today = () => new Date().toISOString().slice(0, 10);

async function signIn(): Promise<string> {
  const res = await request(running.app)
    .post('/api/auth/signup')
    .send({
      name: 'Sharer',
      email: `s${randomUUID()}@example.test`,
      password: 'Sharer@1234',
    });
  const raw = res.headers['set-cookie'];
  return (Array.isArray(raw) ? raw : [raw ?? '']).map((c) => c.split(';')[0]).join('; ');
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'nutriai-share-'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  running = await createApp({
    ...getConfig(),
    dbDriver: 'sqlite',
    databasePath: join(dir, 'share.db'),
  });
});

afterEach(async () => {
  await running?.close();
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('building the share card', () => {
  it('answers for a brand-new account with nothing logged', async () => {
    // The case that broke: every column in the query has to exist, and the
    // only way to find out is to run it. A 500 here is the outage.
    const cookie = await signIn();

    const res = await request(running.app)
      .get(`/api/share/today?date=${today()}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.calories).toBeDefined();
  });

  it('returns the goals the card draws its bars from', async () => {
    // Steps, carbs and fat used to arrive without targets, so they could only
    // be printed as bare numbers. The keys must be present — null is a valid
    // value, absent is not, because the card branches on `null` to decide
    // whether to draw a bar at all.
    const cookie = await signIn();

    const res = await request(running.app)
      .get(`/api/share/today?date=${today()}`)
      .set('Cookie', cookie);

    expect(res.body).toHaveProperty('steps_goal');
    expect(res.body).toHaveProperty('carbs_goal_g');
    expect(res.body).toHaveProperty('fat_goal_g');
  });

  it('reports no step goal rather than failing when there is no plan', async () => {
    // The step goal lives on the active goal plan, and a fresh account has
    // none. Null means "draw no bar"; throwing would mean no card.
    const cookie = await signIn();

    const res = await request(running.app)
      .get(`/api/share/today?date=${today()}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.steps_goal).toBeNull();
  });

  it('requires a session', async () => {
    const res = await request(running.app).get(`/api/share/today?date=${today()}`);
    expect(res.status).toBe(401);
  });
});
