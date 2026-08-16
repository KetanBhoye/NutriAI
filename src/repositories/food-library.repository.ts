import { normalizeFoodName } from '../utils/food-normalize.js';
import { utcDate } from '../db/time.js';
import { rankSuggestions, type LoggedFoodRow } from '../services/food-ranking.js';

export interface FoodRow {
  id: string;
  canonical_name: string;
  normalized_key: string;
  reference_unit: string;
  calories_per_unit: number;
  protein_g_per_unit: number | null;
  carbs_g_per_unit: number | null;
  fat_g_per_unit: number | null;
  default_quantity: number;
  source: string;
}

export interface SuggestedFood extends FoodRow {
  /** Times this food has been logged in the requested meal slot. */
  times_logged: number;
  last_logged: string;
  score: number;
}

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

/** Scoring constants now live with the ranking maths. */
export { RECENCY_HALF_LIFE_DAYS } from '../services/food-ranking.js';

export class FoodLibraryRepository {
  constructor(private db: any) {}

  /**
   * Top foods for a meal slot, ranked by recency-weighted frequency.
   *
   * Day-of-week weighting was considered and deliberately left out: across the
   * history there are only ~16 weekend days, and weekend vs weekday intake
   * differs by ~7%, which is noise at that sample size.
   */
  async suggestForMeal(
    userId: string,
    mealType: MealType,
    limit = 8
  ): Promise<SuggestedFood[]> {
    // Returns one row per logged entry and ranks them in TypeScript. The
    // scoring used to live in this query via `julianday()`, which does not
    // exist in Postgres — it was the only query in the codebase doing date
    // arithmetic in SQL, and the only endpoint that 500'd on Postgres.
    // See services/food-ranking.ts.
    const result = await this.db
      .prepare(
        `
        SELECT
          f.id, f.canonical_name, f.normalized_key, f.reference_unit,
          f.calories_per_unit, f.protein_g_per_unit, f.carbs_g_per_unit,
          f.fat_g_per_unit, f.default_quantity, f.source,
          e.entry_date
        FROM food_entries e
        JOIN foods f ON f.id = e.food_id
        WHERE e.user_id = ? AND e.meal_type = ?
        `
      )
      .bind(userId, mealType)
      .all();

    return rankSuggestions(result.results as LoggedFoodRow[], utcDate(), limit);
  }

  /**
   * Finds a library food matching free text, first on the exact normalised
   * key and then via a recorded alias. Returns null when nothing matches, which
   * is the signal to fall back to an external food database.
   */
  async findByName(userId: string, name: string): Promise<FoodRow | null> {
    const key = normalizeFoodName(name);
    if (!key) return null;

    const direct = await this.db
      .prepare('SELECT * FROM foods WHERE user_id = ? AND normalized_key = ?')
      .bind(userId, key)
      .first();

    if (direct) return direct as FoodRow;

    const viaAlias = await this.db
      .prepare(
        `
        SELECT f.* FROM foods f
        JOIN food_aliases a ON a.food_id = f.id
        WHERE a.user_id = ? AND a.alias_key = ?
        `
      )
      .bind(userId, key)
      .first();

    return (viaAlias as FoodRow) ?? null;
  }

  /** Substring search over canonical names, most-logged first. */
  async search(userId: string, query: string, limit = 20): Promise<SuggestedFood[]> {
    const result = await this.db
      .prepare(
        `
        SELECT
          f.id, f.canonical_name, f.normalized_key, f.reference_unit,
          f.calories_per_unit, f.protein_g_per_unit, f.carbs_g_per_unit,
          f.fat_g_per_unit, f.default_quantity, f.source,
          COUNT(e.id) AS times_logged,
          MAX(e.entry_date) AS last_logged,
          COUNT(e.id) AS score
        FROM foods f
        LEFT JOIN food_entries e ON e.food_id = f.id
        WHERE f.user_id = ? AND LOWER(f.canonical_name) LIKE LOWER(?)
        GROUP BY f.id
        ORDER BY times_logged DESC, f.canonical_name ASC
        LIMIT ?
        `
      )
      .bind(userId, `%${query}%`, limit)
      .all();

    return result.results as SuggestedFood[];
  }

  /** Adds a food to the personal library, or returns the existing match. */
  async upsert(
    userId: string,
    food: Omit<FoodRow, 'id' | 'normalized_key'> & { normalized_key?: string }
  ): Promise<string> {
    const key = food.normalized_key ?? normalizeFoodName(food.canonical_name);

    const existing = await this.db
      .prepare('SELECT id FROM foods WHERE user_id = ? AND normalized_key = ?')
      .bind(userId, key)
      .first();

    if (existing) return (existing as { id: string }).id;

    const id = crypto.randomUUID();
    await this.db
      .prepare(
        `
        INSERT INTO foods (
          id, user_id, canonical_name, normalized_key, reference_unit,
          reference_quantity, calories_per_unit, protein_g_per_unit,
          carbs_g_per_unit, fat_g_per_unit, default_quantity, source
        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
        `
      )
      .bind(
        id,
        userId,
        food.canonical_name,
        key,
        food.reference_unit,
        food.calories_per_unit,
        food.protein_g_per_unit,
        food.carbs_g_per_unit,
        food.fat_g_per_unit,
        food.default_quantity,
        food.source
      )
      .run();

    return id;
  }
}
