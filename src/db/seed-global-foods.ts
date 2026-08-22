import { existsSync, readFileSync } from 'node:fs';
import type { D1DatabaseCompat } from './types.js';
import { sqlTimestampNow } from './time.js';
import type { CuratedFood } from '../services/food/indb.js';

/**
 * Loading the curated Indian food library into `global_foods`.
 *
 * Runs at boot, does nothing at all unless the seed file is present and its
 * version differs from what was last loaded. That matters because the file is
 * ~800 rows and a server restart is not an event that should cost 800 writes.
 *
 * The data and its terms are described in ATTRIBUTIONS.md. The file itself is
 * not committed: it is generated from a dataset with its own licence, so the
 * repository carries the code that builds it and the citation, not the tables.
 * A deployment without the file simply has no seeded library, which is the
 * behaviour that existed before this.
 *
 * Not to be confused with `src/scripts/seed-curated-foods.ts`, which is a
 * manual CLI that fills one *user's* `foods` table from a markdown macros
 * cache. This one runs at boot and writes the shared table.
 *
 * Rows are written as `source: 'curated'` — the top of SOURCE_RANK in
 * services/food/global-repo.ts — so a later grounded lookup or community
 * contribution can never overwrite an ICMR-NIN-derived number with a guess.
 * The reverse is intended: seeding *replaces* lower-trust rows for the same
 * food, because that is the whole point of having a curated tier.
 */

const VERSION_KEY = 'global_foods.seed_version';

interface SeedFile {
  version: string;
  source: string;
  foods: CuratedFood[];
}

async function loadedVersion(db: D1DatabaseCompat): Promise<string | null> {
  const row = await db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .bind(VERSION_KEY)
    .first<{ value: string }>();
  return row?.value ?? null;
}

/**
 * Returns how many rows were written. Zero means "already current" — not a
 * failure, and the common case on every restart after the first.
 */
export async function seedGlobalFoods(db: D1DatabaseCompat, seedPath: string): Promise<number> {
  if (!existsSync(seedPath)) return 0;

  let seed: SeedFile;
  try {
    seed = JSON.parse(readFileSync(seedPath, 'utf8')) as SeedFile;
  } catch (error) {
    // A malformed seed file must not stop the server from starting: the app
    // works without a curated library, it just works less well.
    console.error('[seed] could not read the curated food seed:', error);
    return 0;
  }
  if (!seed?.version || !Array.isArray(seed.foods)) {
    console.error('[seed] curated food seed is missing version or foods');
    return 0;
  }

  if ((await loadedVersion(db)) === seed.version) return 0;

  const now = sqlTimestampNow();
  let written = 0;

  for (const food of seed.foods) {
    // Every name the dish goes by is its own row: the table is keyed by
    // normalized_key, and a search for "suji" must find the semolina porridge.
    const keys = [food.normalized_key, ...(food.aliases ?? [])];
    for (const key of keys) {
      try {
        await db
          .prepare(
            `INSERT INTO global_foods
               (normalized_key, canonical_name, reference_unit, reference_quantity,
                calories_per_unit, protein_g_per_unit, carbs_g_per_unit, fat_g_per_unit,
                default_quantity, source, source_ref, contributor_count, hit_count,
                created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'curated', ?, 1, 0, ?, ?)
             ON CONFLICT (normalized_key) DO UPDATE SET
               canonical_name = excluded.canonical_name,
               reference_unit = excluded.reference_unit,
               reference_quantity = excluded.reference_quantity,
               calories_per_unit = excluded.calories_per_unit,
               protein_g_per_unit = excluded.protein_g_per_unit,
               carbs_g_per_unit = excluded.carbs_g_per_unit,
               fat_g_per_unit = excluded.fat_g_per_unit,
               default_quantity = excluded.default_quantity,
               source = 'curated',
               source_ref = excluded.source_ref,
               updated_at = excluded.updated_at`
          )
          .bind(
            key,
            food.canonical_name,
            food.reference_unit,
            food.reference_quantity,
            food.calories_per_unit,
            food.protein_g_per_unit,
            food.carbs_g_per_unit,
            food.fat_g_per_unit,
            food.default_quantity,
            food.source_ref,
            now,
            now
          )
          .run();
        written += 1;
      } catch (error) {
        // One bad row is not worth abandoning the other eight hundred.
        console.error(`[seed] failed on "${key}":`, error);
      }
    }
  }

  await db
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at, updated_by)
       VALUES (?, ?, ?, 'seed')
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind(VERSION_KEY, seed.version, now)
    .run();

  console.log(`[seed] curated food library ${seed.version}: ${written} rows`);
  return written;
}
