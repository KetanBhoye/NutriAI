import { normalizeFoodName } from '../../utils/food-normalize.js';

/**
 * Turning the Indian Nutrient Databank into rows we are willing to put in
 * someone's diary.
 *
 * INDB (see ATTRIBUTIONS.md) is the best Indian dish-level data available: 1,014
 * cooked recipes built on ICMR-NIN's IFCT 2017/2004, with nutrient retention
 * factors applied. It is not, however, uniformly safe to ship, and the unsafe
 * rows fail in a way that arithmetic cannot detect:
 *
 *     Paneer pulao            581.9 kcal/100g   fat 59.8 g/100g
 *     Flattened rice cutlet   701.7 kcal/100g   fat 73.9 g/100g
 *
 * Both are internally consistent — energy matches macros to within 1% — so an
 * Atwater check passes them. They are wrong because the recipe counts *all* the
 * frying oil into the dish rather than the fraction actually absorbed. A rice
 * dish is not 60% fat.
 *
 * So there are two independent gates here: one for arithmetic (does the energy
 * match the macros) and one for plausibility (could a dish of this kind really
 * be this dense). Neither subsumes the other, and a row must pass both.
 *
 * Everything a row is rejected for is reported rather than silently dropped —
 * the rejects are the interesting part of an import, and the list is short
 * enough for a person to read.
 */

/** One row of the published INDB workbook, as far as we use it. */
export interface IndbRow {
  food_code: string;
  food_name: string;
  /** Per 100 g of the prepared dish. */
  energy_kcal: number;
  carb_g: number;
  protein_g: number;
  fat_g: number;
  /** What one serving is called: "chapati", "bowl", "plate". */
  servings_unit?: string | null;
  /** Energy of one serving, from which its weight is derived. */
  unit_serving_energy_kcal?: number | null;
}

export interface CuratedFood {
  /** The name as INDB gives it, minus the alias soup. */
  canonical_name: string;
  normalized_key: string;
  /** Always 'g' — the app's portion model is grams throughout. */
  reference_unit: 'g';
  reference_quantity: 1;
  calories_per_unit: number;
  protein_g_per_unit: number;
  carbs_g_per_unit: number;
  fat_g_per_unit: number;
  /** A typical portion in grams, derived from INDB's serving energy. */
  default_quantity: number;
  /** Traceable back to the source row, e.g. "INDB:ASC001". See ATTRIBUTIONS.md. */
  source_ref: string;
  /** Other names for the same dish, each its own lookup key. */
  aliases: string[];
}

export interface Rejection {
  food_code: string;
  food_name: string;
  reason: string;
  detail: string;
}

/** Nothing prepared can beat pure fat, and pure fat is 900 kcal/100 g. */
const MAX_KCAL_PER_100G = 900;

/**
 * Fat, as a share of energy, above which a dish is treated as a modelling
 * error unless it is *meant* to be mostly fat.
 *
 * Measured against the data rather than picked: the rows that are wrong sit at
 * 0.92 (Paneer pulao) and 0.95 (fried cutlet), while genuinely rich food — a
 * korma, a malai dish — sits at 0.65 to 0.75. 0.80 separates them with room on
 * both sides. Tightening it starts deleting real Indian food, which would make
 * the library worse rather than safer.
 */
const MAX_FAT_ENERGY_SHARE = 0.8;

/**
 * Dishes that really are mostly fat, and are exempt.
 *
 * Matched on the name because the dataset carries no category. A short,
 * explicit list beats a clever rule here: it is auditable, and every entry on
 * it is a food a person would expect to be fat.
 */
const FAT_BY_NATURE = /\b(ghee|butter|oil|mayonnaise|cream|malai|peanut butter|coconut chutney)\b/i;

/**
 * A serving outside this range is a whole-recipe figure, not a portion.
 *
 * 800 g is generous for one plate including gravy; above it the numbers are
 * describing the dish the recipe makes. "Tandoori chicken, 1441 g" is the
 * whole bird — shipping that as a default portion would log a family meal as
 * one person's dinner.
 */
const MIN_SERVING_G = 10;
const MAX_SERVING_G = 800;
/** Used when INDB's serving figure is unusable; 100 g is the honest default. */
export const FALLBACK_SERVING_G = 100;

/** Energy implied by the macros, per the Atwater factors. */
export function atwaterKcal(row: Pick<IndbRow, 'carb_g' | 'protein_g' | 'fat_g'>): number {
  return 4 * row.carb_g + 4 * row.protein_g + 9 * row.fat_g;
}

/**
 * The weight of one serving, from its energy and the dish's energy density.
 *
 * Returns the fallback when the arithmetic gives something no plate holds —
 * "Tandoori chicken, 1441 g" is the whole bird, not a portion.
 */
export function servingGrams(row: IndbRow): number {
  const servingKcal = row.unit_serving_energy_kcal;
  if (!servingKcal || servingKcal <= 0 || row.energy_kcal <= 0) return FALLBACK_SERVING_G;

  const grams = (100 * servingKcal) / row.energy_kcal;
  if (!Number.isFinite(grams) || grams < MIN_SERVING_G || grams > MAX_SERVING_G) {
    return FALLBACK_SERVING_G;
  }
  return Math.round(grams);
}

/**
 * Splits INDB's naming convention into separate lookup names.
 *
 * Names carry the local name alongside the English one — "Chapati/Roti",
 * "Semolina porridge (Suji/Rava daliya)" — and a user searching "roti" or
 * "rava daliya" must find the dish. Each alternative becomes its own key,
 * because the shared table is keyed by name and a row is cheap.
 */
export function nameVariants(foodName: string): string[] {
  const variants = new Set<string>();
  const bracketed = [...foodName.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]!);
  const outside = foodName.replace(/\([^)]*\)/g, ' ');

  for (const chunk of [outside, ...bracketed]) {
    for (const part of chunk.split('/')) {
      const cleaned = part.replace(/\s+/g, ' ').trim();
      // Two characters filters the debris left by splitting, not real names.
      if (cleaned.length > 2) variants.add(cleaned);
    }
  }
  return [...variants];
}

/**
 * Converts one row, or explains why it cannot be trusted.
 *
 * Rejections carry the numbers that caused them so an import report is
 * reviewable without opening the spreadsheet.
 */
export function curateRow(row: IndbRow): { food: CuratedFood } | { rejected: Rejection } {
  const reject = (reason: string, detail: string) => ({
    rejected: { food_code: row.food_code, food_name: row.food_name, reason, detail },
  });

  const name = row.food_name?.trim();
  if (!name) return reject('no_name', 'row has no food_name');

  if (!Number.isFinite(row.energy_kcal) || row.energy_kcal <= 0) {
    return reject('no_energy', `energy_kcal=${row.energy_kcal}`);
  }
  if (row.energy_kcal > MAX_KCAL_PER_100G) {
    return reject('impossible_energy', `${row.energy_kcal.toFixed(1)} kcal/100g exceeds pure fat`);
  }
  for (const [field, value] of [
    ['carb_g', row.carb_g],
    ['protein_g', row.protein_g],
    ['fat_g', row.fat_g],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) return reject('bad_macro', `${field}=${value}`);
  }

  // Gate 1: arithmetic. Does the stated energy match the stated macros?
  const atwater = atwaterKcal(row);
  if (atwater <= 0) return reject('no_macros', 'carbs, protein and fat are all zero');
  const ratio = row.energy_kcal / atwater;
  if (ratio < 0.85 || ratio > 1.15) {
    return reject(
      'energy_macro_mismatch',
      `${row.energy_kcal.toFixed(1)} kcal vs ${atwater.toFixed(1)} from macros (${ratio.toFixed(2)}x)`
    );
  }

  // Gate 2: plausibility. Could a dish of this kind be this rich?
  const fatShare = (9 * row.fat_g) / row.energy_kcal;
  if (fatShare > MAX_FAT_ENERGY_SHARE && !FAT_BY_NATURE.test(name)) {
    return reject(
      'implausible_fat',
      `${row.fat_g.toFixed(1)}g fat/100g is ${(fatShare * 100).toFixed(0)}% of energy`
    );
  }

  const normalized_key = normalizeFoodName(name);
  if (!normalized_key) return reject('no_key', `"${name}" normalises to nothing`);

  const variants = nameVariants(name);
  const aliases = variants
    .map((variant) => normalizeFoodName(variant))
    .filter((key) => key && key !== normalized_key);

  return {
    food: {
      canonical_name: name,
      normalized_key,
      reference_unit: 'g',
      reference_quantity: 1,
      // Stored per gram: the table's contract, and the app's portion model.
      calories_per_unit: row.energy_kcal / 100,
      protein_g_per_unit: row.protein_g / 100,
      carbs_g_per_unit: row.carb_g / 100,
      fat_g_per_unit: row.fat_g / 100,
      default_quantity: servingGrams(row),
      source_ref: `INDB:${row.food_code}`,
      aliases: [...new Set(aliases)],
    },
  };
}

export interface CurationReport {
  foods: CuratedFood[];
  rejected: Rejection[];
}

/**
 * Curates a whole workbook, keeping the first row for any name that repeats.
 *
 * INDB has near-duplicates ("Idli" and "Instant idli (with semolina)" are
 * different dishes, but some variants collapse to the same key once normalised)
 * and the shared table is keyed by name, so a later row would otherwise
 * overwrite an earlier one arbitrarily.
 */
export function curate(rows: IndbRow[]): CurationReport {
  const foods: CuratedFood[] = [];
  const rejected: Rejection[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const result = curateRow(row);
    if ('rejected' in result) {
      rejected.push(result.rejected);
      continue;
    }
    if (seen.has(result.food.normalized_key)) {
      rejected.push({
        food_code: row.food_code,
        food_name: row.food_name,
        reason: 'duplicate_key',
        detail: `"${result.food.normalized_key}" already taken`,
      });
      continue;
    }
    seen.add(result.food.normalized_key);
    foods.push(result.food);
  }

  return { foods, rejected };
}
