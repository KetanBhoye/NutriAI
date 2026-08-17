import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSqliteDatabase } from '../../db/sqlite-adapter.js';
import type { D1DatabaseCompat } from '../../db/types.js';
import {
  contributeFood,
  findGlobalFood,
  PROMOTION_THRESHOLD,
  saveVerifiedFood,
} from './global-repo.js';

/**
 * The shared repo, against a real SQLite database.
 *
 * The privacy threshold is the part worth testing hardest: it is the only thing
 * stopping one person's "mum's birthday cake" appearing in a table other people
 * read, and it fails silently if the contributor count ever counts *logs*
 * rather than *people*.
 */

let dir: string;
let raw: ReturnType<typeof openSqliteDatabase>['raw'];
let db: D1DatabaseCompat;

const facts = (name: string, kcal = 250) => ({
  canonicalName: name,
  caloriesPerUnit: kcal,
  proteinGPerUnit: 12,
  carbsGPerUnit: 30,
  fatGPerUnit: 8,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nutriai-globalfood-'));
  const opened = openSqliteDatabase(join(dir, 'test.db'));
  raw = opened.raw;
  db = opened.compat;
  raw.exec(`
    CREATE TABLE global_foods (
      normalized_key TEXT PRIMARY KEY,
      canonical_name TEXT NOT NULL,
      reference_unit TEXT NOT NULL DEFAULT 'serving',
      reference_quantity REAL NOT NULL DEFAULT 1,
      calories_per_unit REAL NOT NULL,
      protein_g_per_unit REAL,
      carbs_g_per_unit REAL,
      fat_g_per_unit REAL,
      source TEXT NOT NULL,
      contributor_count INTEGER NOT NULL DEFAULT 1,
      hit_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE global_food_contributors (
      normalized_key TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT,
      PRIMARY KEY (normalized_key, user_id)
    );
  `);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  raw.close();
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('the privacy threshold', () => {
  it('does not share a food one person logged', async () => {
    // The case this exists for: a private label must not reach a table other
    // people can read.
    await contributeFood(db, 'user-1', facts("mum's birthday cake"));
    expect(await findGlobalFood(db, "mum's birthday cake")).toBeNull();
  });

  it('does not share it however many times that one person logs it', async () => {
    // The subtle failure: counting logs instead of people lets a single user
    // promote their own private label just by eating it every day.
    for (let i = 0; i < 20; i += 1) {
      await contributeFood(db, 'user-1', facts("tuesday meal prep"));
    }
    expect(await findGlobalFood(db, 'tuesday meal prep')).toBeNull();
  });

  it('shares it once enough distinct people have logged it', async () => {
    for (let i = 0; i < PROMOTION_THRESHOLD; i += 1) {
      await contributeFood(db, `user-${i}`, facts('dal tadka'));
    }
    const found = await findGlobalFood(db, 'dal tadka');
    expect(found?.canonical_name).toBe('dal tadka');
    expect(found?.source).toBe('community');
    expect(found?.contributor_count).toBe(PROMOTION_THRESHOLD);
  });

  it('stays private one contributor below the threshold', async () => {
    for (let i = 0; i < PROMOTION_THRESHOLD - 1; i += 1) {
      await contributeFood(db, `user-${i}`, facts('very specific leftovers'));
    }
    expect(await findGlobalFood(db, 'very specific leftovers')).toBeNull();
  });
});

describe('trusted sources', () => {
  it('shares a grounded result immediately, with no threshold', async () => {
    // The name came from a nutrition source, not from someone describing their
    // own day, so neither the privacy nor the quality argument applies.
    await saveVerifiedFood(db, facts('cooked white rice 150g', 205), 'grounded');
    expect((await findGlobalFood(db, 'cooked white rice 150g'))?.source).toBe('grounded');
  });

  it('does not let a weaker source overwrite a stronger one', async () => {
    // One nutrition database beats three people agreeing.
    await saveVerifiedFood(db, facts('paneer 100g', 265), 'curated');
    await saveVerifiedFood(db, facts('paneer 100g', 999), 'grounded');

    const found = await findGlobalFood(db, 'paneer 100g');
    expect(found?.source).toBe('curated');
    expect(found?.calories_per_unit).toBe(265);
  });

  it('lets a stronger source correct a weaker one', async () => {
    await saveVerifiedFood(db, facts('idli', 100), 'grounded');
    await saveVerifiedFood(db, facts('idli', 58), 'usda');

    const found = await findGlobalFood(db, 'idli');
    expect(found?.source).toBe('usda');
    expect(found?.calories_per_unit).toBe(58);
  });

  it('keeps trusted numbers when a crowd later agrees on the name', async () => {
    await saveVerifiedFood(db, facts('roti', 120), 'usda');
    for (let i = 0; i < PROMOTION_THRESHOLD + 2; i += 1) {
      await contributeFood(db, `user-${i}`, facts('roti', 300));
    }

    const found = await findGlobalFood(db, 'roti');
    expect(found?.source).toBe('usda');
    expect(found?.calories_per_unit).toBe(120);
    // The crowd still counts — it just does not get to change the numbers.
    expect(found?.contributor_count).toBeGreaterThanOrEqual(PROMOTION_THRESHOLD);
  });
});

describe('name matching', () => {
  it('collapses spelling and spacing variants onto one row', async () => {
    // The whole saving depends on this: if "2 Roti" and "2 roti" are separate
    // rows, both get billed.
    await saveVerifiedFood(db, facts('Dal Tadka', 180), 'grounded');
    expect(await findGlobalFood(db, 'dal tadka')).not.toBeNull();
    expect(await findGlobalFood(db, '  DAL   TADKA ')).not.toBeNull();
  });

  it('ignores an empty name rather than creating a junk row', async () => {
    await saveVerifiedFood(db, facts('   ', 100), 'grounded');
    expect(await findGlobalFood(db, '   ')).toBeNull();
  });

  it('ignores a zero or negative calorie figure', async () => {
    await saveVerifiedFood(db, facts('broken entry', 0), 'grounded');
    expect(await findGlobalFood(db, 'broken entry')).toBeNull();
  });
});

describe('hit counting', () => {
  it('counts every cache hit, because that is the money saved', async () => {
    await saveVerifiedFood(db, facts('poha', 250), 'grounded');
    await findGlobalFood(db, 'poha');
    await findGlobalFood(db, 'poha');

    const row = raw.prepare('SELECT hit_count FROM global_foods WHERE canonical_name = ?').get('poha') as {
      hit_count: number;
    };
    // Each hit is one grounded search not performed.
    expect(row.hit_count).toBe(2);
  });
});
