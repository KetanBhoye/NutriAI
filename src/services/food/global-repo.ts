import type { D1DatabaseCompat } from '../../db/types.js';
import { sqlTimestampNow } from '../../db/time.js';
import { normalizeFoodName } from '../../utils/food-normalize.js';

/**
 * The shared food repository.
 *
 * "2 roti" is the same lookup for every user on the platform, and today each
 * one is billed as its own grounded search at roughly seventeen times the cost
 * of a coach message. This is the table that stops paying twice for the same
 * food — and unlike a quota, it gets *better* as the app grows rather than
 * more expensive.
 *
 * Two safeguards, because a naive "copy every food anyone logs into a global
 * table" would be worse than no cache at all:
 *
 *   **Privacy.** A personal library contains names like "mum's birthday cake"
 *   or "Tuesday meal prep". A global table is readable by strangers, so a
 *   free-text name is only promoted once several unrelated people have logged
 *   it — a threshold no personal label reaches.
 *
 *   **Quality.** One person's bad guess would otherwise become the default for
 *   everyone. Rows carry their origin, and a trusted origin is never replaced
 *   by a less trusted one.
 */

/** Highest trust first. A row is never overwritten by a lower-trust source. */
export const SOURCE_RANK = {
  curated: 4,
  usda: 3,
  openfoodfacts: 3,
  grounded: 2,
  community: 1,
} as const;

export type GlobalFoodSource = keyof typeof SOURCE_RANK;

/**
 * How many distinct users must log a name before it is shared.
 *
 * Three is the smallest number that means "not one person and not a typo".
 * It is the whole privacy mechanism, so it should only ever move up.
 */
export const PROMOTION_THRESHOLD = 3;

export interface GlobalFood {
  normalized_key: string;
  canonical_name: string;
  reference_unit: string;
  reference_quantity: number;
  calories_per_unit: number;
  protein_g_per_unit: number | null;
  carbs_g_per_unit: number | null;
  fat_g_per_unit: number | null;
  source: GlobalFoodSource;
  contributor_count: number;
  hit_count: number;
}

/**
 * Looks a food up in the shared repo.
 *
 * A hit here is a grounded search not performed, so the counter is the number
 * that says whether this table is earning its keep. Counting is best-effort:
 * failing to increment must never cost the caller their answer.
 */
export async function findGlobalFood(
  db: D1DatabaseCompat,
  name: string
): Promise<GlobalFood | null> {
  const key = normalizeFoodName(name);
  if (!key) return null;

  const row = await db
    .prepare(
      `SELECT normalized_key, canonical_name, reference_unit, reference_quantity,
              calories_per_unit, protein_g_per_unit, carbs_g_per_unit, fat_g_per_unit,
              source, contributor_count, hit_count
       FROM global_foods WHERE normalized_key = ?`
    )
    .bind(key)
    .first<GlobalFood>();

  if (!row) return null;

  try {
    await db
      .prepare('UPDATE global_foods SET hit_count = hit_count + 1 WHERE normalized_key = ?')
      .bind(key)
      .run();
  } catch {
    // Counter only.
  }

  return row;
}

export interface FoodFacts {
  canonicalName: string;
  referenceUnit?: string;
  referenceQuantity?: number;
  caloriesPerUnit: number;
  proteinGPerUnit?: number | null;
  carbsGPerUnit?: number | null;
  fatGPerUnit?: number | null;
}

/**
 * Writes a result from a trusted origin (a grounded lookup, a barcode scan, the
 * curated set) straight into the repo.
 *
 * No threshold applies: the name came from a nutrition source rather than from
 * something a person typed about their own day, so neither the privacy nor the
 * quality argument bites. An existing row from a *more* trusted origin is left
 * alone.
 */
export async function saveVerifiedFood(
  db: D1DatabaseCompat,
  facts: FoodFacts,
  source: Exclude<GlobalFoodSource, 'community'>
): Promise<void> {
  const key = normalizeFoodName(facts.canonicalName);
  if (!key || !Number.isFinite(facts.caloriesPerUnit) || facts.caloriesPerUnit <= 0) return;

  try {
    const existing = await db
      .prepare('SELECT source FROM global_foods WHERE normalized_key = ?')
      .bind(key)
      .first<{ source: GlobalFoodSource }>();

    if (existing && SOURCE_RANK[existing.source] > SOURCE_RANK[source]) return;

    const now = sqlTimestampNow();
    if (existing) {
      await db
        .prepare(
          `UPDATE global_foods SET canonical_name = ?, reference_unit = ?, reference_quantity = ?,
             calories_per_unit = ?, protein_g_per_unit = ?, carbs_g_per_unit = ?,
             fat_g_per_unit = ?, source = ?, updated_at = ?
           WHERE normalized_key = ?`
        )
        .bind(
          facts.canonicalName,
          facts.referenceUnit ?? 'serving',
          facts.referenceQuantity ?? 1,
          facts.caloriesPerUnit,
          facts.proteinGPerUnit ?? null,
          facts.carbsGPerUnit ?? null,
          facts.fatGPerUnit ?? null,
          source,
          now,
          key
        )
        .run();
      return;
    }

    await db
      .prepare(
        `INSERT INTO global_foods
           (normalized_key, canonical_name, reference_unit, reference_quantity,
            calories_per_unit, protein_g_per_unit, carbs_g_per_unit, fat_g_per_unit,
            source, contributor_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      )
      .bind(
        key,
        facts.canonicalName,
        facts.referenceUnit ?? 'serving',
        facts.referenceQuantity ?? 1,
        facts.caloriesPerUnit,
        facts.proteinGPerUnit ?? null,
        facts.carbsGPerUnit ?? null,
        facts.fatGPerUnit ?? null,
        source,
        now,
        now
      )
      .run();
  } catch (error) {
    console.error(
      '[food] failed to save verified food:',
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Records that a user logged a food by name, and promotes it to the shared repo
 * once enough distinct people have done the same.
 *
 * This is the community path — the one that makes the repo grow from ordinary
 * use rather than only from paid lookups. It is also the one that needs the
 * threshold, so `global_food_contributors` tracks *who*, not just how many.
 *
 * Never overwrites a row from a trusted source: three people agreeing on a name
 * is weaker evidence than one nutrition database.
 */
export async function contributeFood(
  db: D1DatabaseCompat,
  userId: string,
  facts: FoodFacts
): Promise<void> {
  const key = normalizeFoodName(facts.canonicalName);
  if (!key || !Number.isFinite(facts.caloriesPerUnit) || facts.caloriesPerUnit <= 0) return;

  try {
    // Idempotent per user: logging the same food daily must not let one person
    // reach the threshold alone.
    await db
      .prepare(
        `INSERT INTO global_food_contributors (normalized_key, user_id, created_at)
         VALUES (?, ?, ?)
         ON CONFLICT (normalized_key, user_id) DO NOTHING`
      )
      .bind(key, userId, sqlTimestampNow())
      .run();

    const countRow = await db
      .prepare('SELECT COUNT(*) AS n FROM global_food_contributors WHERE normalized_key = ?')
      .bind(key)
      .first<{ n: number }>();
    const contributors = Number(countRow?.n ?? 0);
    if (contributors < PROMOTION_THRESHOLD) return;

    const existing = await db
      .prepare('SELECT source FROM global_foods WHERE normalized_key = ?')
      .bind(key)
      .first<{ source: GlobalFoodSource }>();

    if (existing) {
      // Keep the better source's numbers; just record that more people use it.
      await db
        .prepare('UPDATE global_foods SET contributor_count = ? WHERE normalized_key = ?')
        .bind(contributors, key)
        .run();
      return;
    }

    const now = sqlTimestampNow();
    await db
      .prepare(
        `INSERT INTO global_foods
           (normalized_key, canonical_name, reference_unit, reference_quantity,
            calories_per_unit, protein_g_per_unit, carbs_g_per_unit, fat_g_per_unit,
            source, contributor_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'community', ?, ?, ?)`
      )
      .bind(
        key,
        facts.canonicalName,
        facts.referenceUnit ?? 'serving',
        facts.referenceQuantity ?? 1,
        facts.caloriesPerUnit,
        facts.proteinGPerUnit ?? null,
        facts.carbsGPerUnit ?? null,
        facts.fatGPerUnit ?? null,
        contributors,
        now,
        now
      )
      .run();
  } catch (error) {
    console.error(
      '[food] failed to contribute food:',
      error instanceof Error ? error.message : String(error)
    );
  }
}
