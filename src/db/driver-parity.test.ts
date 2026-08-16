import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import request from 'supertest';
import { createApp } from '../index.js';
import { getConfig } from '../config.js';

/**
 * Runs the same requests against SQLite and Postgres and requires identical
 * answers.
 *
 * This is the test the Postgres migration actually rests on. Every dialect bug
 * found during the port returned HTTP 200 or looked plausible in isolation —
 * `date('now','-6 days')` (no Postgres equivalent), `date` columns arriving as
 * JS Date objects, a bare column name in ON CONFLICT, and expiry comparisons
 * across two timestamp formats. None would have been caught by asserting a
 * status code. Comparing the two drivers' output is what caught them, so that
 * comparison belongs in the suite rather than in someone's terminal history.
 *
 * Needs a Postgres to talk to. Skipped (not failed) without one, so the suite
 * still runs on a machine that has none:
 *
 *   TEST_DATABASE_URL=postgresql://localhost/nutriai_test npm test
 */

/**
 * The shared test setup pins `crypto.randomUUID` to a constant so id-bearing
 * responses are stable to assert against. That is fine for a single insert and
 * fatal here: every row this file writes would collide on the primary key, and
 * the failed inserts are swallowed — the request still answers, just without
 * having stored anything. Restore real ids for this file only.
 */
globalThis.crypto.randomUUID = randomUUID as typeof globalThis.crypto.randomUUID;

const TEST_PG_URL = process.env.TEST_DATABASE_URL;
const describePg = TEST_PG_URL ? describe : describe.skip;

type App = Awaited<ReturnType<typeof createApp>>;

let dir: string;
let sqliteApp: App;
let pgApp: App;

/** Same credentials on both sides so responses are comparable. */
const EMAIL = `parity${Date.now()}@example.test`;
const PASSWORD = 'Parity@1234';
const DATE = '2026-08-16';

async function reset(url: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  // Drop and recreate rather than TRUNCATE: the app runs its own migrations on
  // boot, and this proves they apply to a genuinely empty database every time.
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await client.end();
}

async function signUp(app: App): Promise<string> {
  const res = await request(app.app)
    .post('/api/auth/signup')
    .send({ name: 'Parity', email: EMAIL, password: PASSWORD });
  expect(res.status).toBe(201);
  const raw = res.headers['set-cookie'];
  return (Array.isArray(raw) ? raw : [raw ?? '']).map((c) => c.split(';')[0]).join('; ');
}

/**
 * Fields that legitimately differ between two independent databases — ids are
 * random per insert, timestamps are wall-clock. Comparing them would make the
 * test fail for reasons that say nothing about the drivers.
 */
const VOLATILE = new Set([
  'id',
  'entry_id',
  'user_id',
  'food_id',
  'created_at',
  'updated_at',
  'generated_at',
  'session_id',
]);

function stripVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (VOLATILE.has(k)) continue;
      out[k] = stripVolatile(v);
    }
    return out;
  }
  return value;
}

let sqliteCookie: string;
let pgCookie: string;

beforeAll(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  dir = mkdtempSync(join(tmpdir(), 'nutriai-parity-'));

  const base = getConfig();
  sqliteApp = await createApp({
    ...base,
    dbDriver: 'sqlite',
    databasePath: join(dir, 'parity.db'),
  });
  sqliteCookie = await signUp(sqliteApp);

  if (TEST_PG_URL) {
    await reset(TEST_PG_URL);
    pgApp = await createApp({
      ...base,
      dbDriver: 'postgres',
      databaseUrl: TEST_PG_URL,
      databasePath: join(dir, 'unused.db'),
    });
    pgCookie = await signUp(pgApp);
  }
}, 120_000);

afterAll(async () => {
  await sqliteApp?.close();
  await pgApp?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** Issues the same request to both apps and returns both bodies. */
async function both(
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  body?: unknown
): Promise<{ sqlite: { status: number; body: unknown }; pg: { status: number; body: unknown } }> {
  const run = async (app: App, cookie: string) => {
    const req = request(app.app)[method](path).set('Cookie', cookie);
    const res = body === undefined ? await req : await req.send(body as object);
    return { status: res.status, body: res.body };
  };
  return { sqlite: await run(sqliteApp, sqliteCookie), pg: await run(pgApp, pgCookie) };
}

function expectSame(pair: Awaited<ReturnType<typeof both>>): void {
  expect(pair.pg.status).toBe(pair.sqlite.status);
  expect(stripVolatile(pair.pg.body)).toEqual(stripVolatile(pair.sqlite.body));
}

describePg('the two drivers answer identically', () => {
  it('agrees on a brand-new account', async () => {
    expectSame(await both('get', '/api/me'));
  });

  it('agrees after logging food', async () => {
    const entry = {
      food_name: 'Parity dal',
      calories: 250,
      protein_g: 12,
      carbs_g: 30,
      fat_g: 8,
      meal_type: 'lunch',
      entry_date: DATE,
    };
    const created = await both('post', '/api/entries', entry);
    expect(created.sqlite.status).toBe(201);
    expectSame(created);
    expectSame(await both('get', `/api/entries?date=${DATE}`));
  });

  it('agrees on the dashboard, which aggregates a day', async () => {
    expectSame(await both('get', `/api/dashboard?date=${DATE}`));
  });

  it('agrees on the weekly stats, which use a date window', async () => {
    // This is where `date('now','-6 days')` used to be. A window computed
    // differently on the two drivers shows up here and nowhere else.
    expectSame(await both('get', '/api/stats/weekly'));
  });

  it('agrees on activity, which returns date-typed columns', async () => {
    // `activity_date` is a real `date` column. Without the type parser,
    // Postgres returns a JS Date here and SQLite a string.
    expectSame(await both('post', '/api/activity', { activity_date: DATE, steps: 8500, source: 'manual' }));
    expectSame(await both('get', '/api/activity'));
  });

  it('agrees on the profile history', async () => {
    expectSame(await both('get', '/api/profile/history'));
  });
});

describePg('the food library and its frequency ordering', () => {
  // suggestForMeal was the one query doing date arithmetic in SQL, via
  // SQLite's julianday(). On Postgres this endpoint was the only one that
  // returned a 500, and nothing in the suite exercised it: a bare
  // GET /api/suggestions answers 400 for a missing `meal`, which reads like a
  // pass if you are only watching for 5xx.
  const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

  it('answers for every meal slot on both drivers', async () => {
    for (const meal of MEALS) {
      const pair = await both('get', `/api/suggestions?meal=${meal}`);
      expect(pair.pg.status, `${meal} must not 500 on postgres`).toBe(200);
      expectSame(pair);
    }
  });

  it('ranks previously logged foods the same way on both drivers', async () => {
    // Log one food repeatedly and another once, so the order is decided by the
    // ranking rather than by chance.
    for (let i = 0; i < 3; i += 1) {
      const created = await both('post', '/api/entries', {
        food_name: 'Parity staple',
        calories: 200,
        meal_type: 'breakfast',
        entry_date: `2026-08-1${i + 2}`,
      });
      expect(created.sqlite.status).toBe(201);
    }
    const once = await both('post', '/api/entries', {
      food_name: 'Parity oneoff',
      calories: 200,
      meal_type: 'breakfast',
      entry_date: '2026-08-16',
    });
    expect(once.sqlite.status).toBe(201);

    const pair = await both('get', '/api/suggestions?meal=breakfast');
    expect(pair.pg.status).toBe(200);
    expectSame(pair);

    const names = (body: unknown) =>
      ((body as { suggestions: Array<{ canonical_name: string }> }).suggestions ?? []).map(
        (s) => s.canonical_name
      );
    // Identical order, not merely identical membership.
    expect(names(pair.pg.body)).toEqual(names(pair.sqlite.body));
  });

  it('searches the library identically', async () => {
    expectSame(await both('get', '/api/foods/search?q=parity'));
  });
});

describePg('date columns come back as strings, not Date objects', () => {
  it('returns activity_date as YYYY-MM-DD', async () => {
    const res = await request(pgApp.app).get('/api/activity').set('Cookie', pgCookie);
    const rows = (res.body.activity ?? res.body.days ?? res.body) as Array<Record<string, unknown>>;
    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row) return; // nothing logged is a valid state; the parity test covers content
    expect(typeof row.activity_date).toBe('string');
    expect(row.activity_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describePg('a health sync never overwrites what a person typed', () => {
  // The precedence rule from daily-activity.repository.ts, re-proved on
  // Postgres because ON CONFLICT DO UPDATE has different scoping rules there:
  // a bare column name is ambiguous, and qualifying it wrongly would silently
  // invert this behaviour rather than error.
  const DAY = '2026-08-10';

  it('keeps manual steps when a health sync arrives afterwards', async () => {
    const manual = await both('post', '/api/activity', { activity_date: DAY, steps: 9000, source: 'manual' });
    expect(manual.sqlite.status).toBe(200);
    expectSame(manual);
    expectSame(await both('post', '/api/activity', { activity_date: DAY, steps: 42, source: 'apple_health' }));

    const pair = await both('get', '/api/activity');
    expectSame(pair);

    const find = (body: unknown) => {
      const rows = ((body as Record<string, unknown>).activity ??
        (body as Record<string, unknown>).days ??
        body) as Array<Record<string, unknown>>;
      return Array.isArray(rows) ? rows.find((r) => r.activity_date === DAY) : undefined;
    };
    expect(find(pair.pg.body)?.steps).toBe(9000);
    expect(find(pair.sqlite.body)?.steps).toBe(9000);
  });
});

describePg('numbers survive the round trip', () => {
  it('keeps fractional macros exact rather than rounding to 32-bit', async () => {
    // SQLite REAL is a 64-bit float; Postgres REAL is 32-bit. Mapping the type
    // literally would round every macro slightly, which no status code shows.
    const entry = {
      food_name: 'Parity precision',
      calories: 137,
      protein_g: 12.34,
      carbs_g: 56.78,
      fat_g: 9.01,
      meal_type: 'snack',
      entry_date: '2026-08-11',
    };
    const created = await both('post', '/api/entries', entry);
    expect(created.sqlite.status).toBe(201);

    const pair = await both('get', '/api/entries?date=2026-08-11');
    expectSame(pair);

    const entries = (pair.pg.body as { entries: Array<Record<string, number>> }).entries;
    const logged = entries.find((e) => (e as unknown as { food_name: string }).food_name === 'Parity precision');
    expect(logged?.protein_g).toBe(12.34);
    expect(logged?.carbs_g).toBe(56.78);
  });
});
