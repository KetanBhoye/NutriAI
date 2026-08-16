import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from './index.js';
import { getConfig } from './config.js';
import { clearPopulationCache } from './services/consistency-data.js';

/**
 * GET /api/consistency end to end.
 *
 * The unit tests in services/consistency.test.ts pin the formula; these pin
 * the things only a real request can show — that unlogged days are counted as
 * misses rather than skipped, and that a percentile the server decided to
 * suppress never reaches the client at all.
 */

// Real ids: the shared setup pins randomUUID to a constant, and every row this
// file writes would collide on the primary key.
globalThis.crypto.randomUUID = randomUUID as typeof globalThis.crypto.randomUUID;

let dir: string;
let running: Awaited<ReturnType<typeof createApp>>;

/** A Monday, so the week under test is unambiguous. */
const MONDAY = '2026-08-17';

const start = async () => {
  running = await createApp({
    ...getConfig(),
    dbDriver: 'sqlite',
    databasePath: join(dir, 'consistency.db'),
  });
  return running;
};

async function signUp(): Promise<string> {
  const res = await request(running.app)
    .post('/api/auth/signup')
    .send({ name: 'C', email: `c${randomUUID()}@example.test`, password: 'Test@1234' });
  expect(res.status).toBe(201);
  const raw = res.headers['set-cookie'];
  return (Array.isArray(raw) ? raw : [raw ?? '']).map((c) => c.split(';')[0]).join('; ');
}

async function setGoals(
  cookie: string,
  opts: { calories?: number; protein?: number; stepGoal?: number | null } = {}
): Promise<void> {
  // PUT /api/goals writes the plan and the macro goals in one call; the macro
  // fields are what the consistency score reads.
  const res = await request(running.app)
    .put('/api/goals')
    .set('Cookie', cookie)
    .send({
      start_weight_kg: 75,
      start_date: '2026-08-01',
      goal_weight_kg: 70,
      target_date: '2026-12-01',
      daily_step_goal: opts.stepGoal ?? null,
      daily_calorie_goal: opts.calories ?? 2000,
      daily_protein_goal_g: opts.protein ?? 150,
    });
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(400);
}

async function logDay(cookie: string, date: string, calories: number, protein: number) {
  return request(running.app)
    .post('/api/entries')
    .set('Cookie', cookie)
    .send({ food_name: `Day ${date}`, calories, protein_g: protein, meal_type: 'lunch', entry_date: date });
}

const get = (cookie: string) =>
  request(running.app).get(`/api/consistency?date=${MONDAY}`).set('Cookie', cookie);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nutriai-consistency-'));
  clearPopulationCache();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
  await running?.close();
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('a user who has not set targets yet', () => {
  it('is told so rather than scored against numbers they never chose', async () => {
    await start();
    const cookie = await signUp();
    const res = await get(cookie);
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.reason).toBe('no_targets');
  });
});

describe('scoring a real week', () => {
  it('counts unlogged days as misses, not as absent', async () => {
    // The property that makes this a *consistency* score. Averaging only the
    // logged days would hand a perfect 100 to someone who logged once.
    await start();
    const cookie = await signUp();
    await setGoals(cookie);
    await logDay(cookie, MONDAY, 2000, 150);

    const res = await get(cookie);
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.days_logged).toBe(1);
    expect(res.body.score).toBeLessThan(25);
  });

  it('scores a fully logged week near the top', async () => {
    await start();
    const cookie = await signUp();
    await setGoals(cookie);
    for (let i = 0; i < 7; i += 1) {
      const date = new Date(Date.parse(`${MONDAY}T00:00:00Z`) + i * 86_400_000)
        .toISOString()
        .slice(0, 10);
      await logDay(cookie, date, 2000, 150);
    }

    const res = await get(cookie);
    expect(res.body.days_logged).toBe(7);
    expect(res.body.score).toBeGreaterThan(90);
  });

  it('returns the component breakdown the card renders', async () => {
    await start();
    const cookie = await signUp();
    await setGoals(cookie);
    await logDay(cookie, MONDAY, 2000, 150);

    const { components } = (await get(cookie)).body;
    expect(components).toHaveProperty('logging');
    expect(components).toHaveProperty('calories');
    expect(components).toHaveProperty('protein');
  });

  it('returns eight weeks of history, oldest first, for the sparkline', async () => {
    await start();
    const cookie = await signUp();
    await setGoals(cookie);

    const { history } = (await get(cookie)).body;
    expect(history).toHaveLength(8);
    expect(history[history.length - 1].week_start ?? history[history.length - 1].weekStart).toBe(
      MONDAY
    );
    const starts = history.map((h: { weekStart?: string; week_start?: string }) => h.weekStart ?? h.week_start);
    expect([...starts].sort()).toEqual(starts);
  });

  it('is deterministic across repeated requests', async () => {
    // No AI anywhere in this path: the same week must always score the same,
    // or "up on last week" is meaningless.
    await start();
    const cookie = await signUp();
    await setGoals(cookie);
    await logDay(cookie, MONDAY, 1900, 140);

    const scores = [] as number[];
    for (let i = 0; i < 3; i += 1) scores.push((await get(cookie)).body.score);
    expect(new Set(scores).size).toBe(1);
  });
});

describe('the peer comparison', () => {
  it('is withheld entirely when the population is too small', async () => {
    // One user is not a population. Crucially the percentile is absent from
    // the payload, not merely flagged off — a client cannot render a number
    // it was never sent.
    await start();
    const cookie = await signUp();
    await setGoals(cookie);
    await logDay(cookie, MONDAY, 2000, 150);

    const res = await get(cookie);
    expect(res.body.comparison).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('better_than_percent');
  });

  it('never leaks a suppressed percentile', async () => {
    await start();
    const cookie = await signUp();
    await setGoals(cookie);
    // Barely logged: below the days-logged floor, so no comparison.
    await logDay(cookie, MONDAY, 1300, 40);

    const body = (await get(cookie)).body;
    expect(body.comparison).toBeNull();
    expect(body).not.toHaveProperty('percentile');
  });
});

describe('the headline', () => {
  it('speaks about the user, not about other people', async () => {
    await start();
    const cookie = await signUp();
    await setGoals(cookie);
    await logDay(cookie, MONDAY, 2000, 150);

    const { headline } = (await get(cookie)).body;
    expect(headline.title).toBeTruthy();
    expect(headline.detail).toBeTruthy();
    // The comparison is a footnote in the UI; it must never be the headline.
    expect(`${headline.title} ${headline.detail}`).not.toMatch(/other (users|members)|than \d+%/);
  });

  it('never scolds, whatever the score', async () => {
    await start();
    const cookie = await signUp();
    await setGoals(cookie);
    await logDay(cookie, MONDAY, 1250, 10); // a poor day

    const { headline } = (await get(cookie)).body;
    const text = `${headline.title} ${headline.detail}`.toLowerCase();
    for (const word of ['failed', 'poor', 'bad', 'should have']) {
      expect(text).not.toContain(word);
    }
  });
});
