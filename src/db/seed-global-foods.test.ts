import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openSqliteDatabase } from './sqlite-adapter.js';
import type { D1DatabaseCompat } from './types.js';
import { seedGlobalFoods } from './seed-global-foods.js';

/**
 * Against a real SQLite database, because everything worth checking here is
 * SQL: the upsert, the version guard, and the promise that a curated row is
 * never replaced by a lower-trust one.
 */
let db: D1DatabaseCompat;
let dir: string;

const chapati = {
  canonical_name: 'Chapati/Roti',
  normalized_key: 'chapati',
  reference_unit: 'g' as const,
  reference_quantity: 1 as const,
  calories_per_unit: 2.023,
  protein_g_per_unit: 0.059,
  carbs_g_per_unit: 0.394,
  fat_g_per_unit: 0.025,
  default_quantity: 36,
  source_ref: 'INDB:ASC096',
  aliases: ['suji'],
};

function seedFile(version: string, foods: unknown[] = [chapati]): string {
  const path = join(dir, `${version}.json`);
  writeFileSync(path, JSON.stringify({ version, source: 'test', foods }));
  return path;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nutriai-seed-'));
  const opened = openSqliteDatabase(join(dir, 'test.db'));
  db = opened.compat;
  opened.raw.exec(`
    CREATE TABLE app_settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_by TEXT
    );
    CREATE TABLE global_foods (
      normalized_key TEXT PRIMARY KEY,
      canonical_name TEXT NOT NULL,
      reference_unit TEXT NOT NULL DEFAULT 'serving',
      reference_quantity REAL NOT NULL DEFAULT 1,
      calories_per_unit REAL NOT NULL,
      protein_g_per_unit REAL, carbs_g_per_unit REAL, fat_g_per_unit REAL,
      source TEXT NOT NULL,
      contributor_count INTEGER NOT NULL DEFAULT 1,
      hit_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      default_quantity REAL NOT NULL DEFAULT 1,
      source_ref TEXT
    );
  `);
});

describe('seedGlobalFoods', () => {
  it('does nothing when there is no seed file, rather than failing to boot', async () => {
    expect(await seedGlobalFoods(db, join(dir, 'absent.json'))).toBe(0);
  });

  it('writes a row for the dish and one for each of its other names', async () => {
    const written = await seedGlobalFoods(db, seedFile('v1'));
    expect(written).toBe(2);

    const row = await db
      .prepare('SELECT * FROM global_foods WHERE normalized_key = ?')
      .bind('chapati')
      .first<Record<string, unknown>>();

    expect(row?.canonical_name).toBe('Chapati/Roti');
    expect(row?.source).toBe('curated');
    expect(row?.source_ref).toBe('INDB:ASC096');
    expect(row?.default_quantity).toBe(36);
    // The alias is a row of its own — the table is keyed by name.
    const alias = await db
      .prepare('SELECT canonical_name FROM global_foods WHERE normalized_key = ?')
      .bind('suji')
      .first<{ canonical_name: string }>();
    expect(alias?.canonical_name).toBe('Chapati/Roti');
  });

  it('skips the whole job when that version is already loaded', async () => {
    const path = seedFile('v1');
    await seedGlobalFoods(db, path);

    expect(await seedGlobalFoods(db, path)).toBe(0);
  });

  it('runs again when the version changes', async () => {
    await seedGlobalFoods(db, seedFile('v1'));

    const updated = { ...chapati, calories_per_unit: 2.1, aliases: [] };
    expect(await seedGlobalFoods(db, seedFile('v2', [updated]))).toBe(1);

    const row = await db
      .prepare('SELECT calories_per_unit FROM global_foods WHERE normalized_key = ?')
      .bind('chapati')
      .first<{ calories_per_unit: number }>();
    expect(row?.calories_per_unit).toBeCloseTo(2.1, 3);
  });

  it('replaces a guess that the community had contributed for the same food', async () => {
    await db
      .prepare(
        `INSERT INTO global_foods (normalized_key, canonical_name, calories_per_unit, source)
         VALUES ('chapati', 'Roti (someone''s guess)', 9.9, 'community')`
      )
      .run();

    await seedGlobalFoods(db, seedFile('v1'));

    const row = await db
      .prepare('SELECT canonical_name, source, calories_per_unit FROM global_foods WHERE normalized_key = ?')
      .bind('chapati')
      .first<{ canonical_name: string; source: string; calories_per_unit: number }>();

    // Curated is the top of SOURCE_RANK: an ICMR-NIN-derived number outranks
    // whatever was cached from a guess.
    expect(row?.source).toBe('curated');
    expect(row?.calories_per_unit).toBeCloseTo(2.023, 3);
  });

  it('survives a malformed seed file', async () => {
    const path = join(dir, 'broken.json');
    writeFileSync(path, '{ this is not json');

    expect(await seedGlobalFoods(db, path)).toBe(0);
  });
});
