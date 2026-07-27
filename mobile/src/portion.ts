/**
 * Portions, in grams.
 *
 * Everything the app logs from here on records a gram weight, because "1
 * serving" is not adjustable in any useful way — stepping it just doubles the
 * meal. The AI photo parser and the food library still speak in household
 * measures ("1 bowl", "2 roti"), so those are converted on the way in.
 */

/** Household measures → grams. Approximate by nature; a portion always is. */
const UNIT_GRAMS: Record<string, number> = {
  // Mass
  g: 1, gm: 1, gms: 1, gram: 1, grams: 1,
  kg: 1000, kilo: 1000, kilogram: 1000,
  oz: 28.35, ounce: 28.35, lb: 453.6, pound: 453.6,
  // Volume, taken at water density — close enough for food logging
  ml: 1, milliliter: 1, millilitre: 1,
  l: 1000, litre: 1000, liter: 1000,
  tsp: 5, teaspoon: 5,
  tbsp: 15, tablespoon: 15,
  cup: 240,
  glass: 250,
  // Vessels this user's food actually comes in
  bowl: 200,
  katori: 150,
  plate: 300,
  scoop: 30,
  // Countables
  slice: 30,
  piece: 50, pc: 50, pcs: 50,
  egg: 50,
  roti: 45, chapati: 45, phulka: 40,
  paratha: 70, naan: 90, poori: 35,
  idli: 40, dosa: 90, vada: 50, samosa: 60,
  banana: 120, apple: 180, orange: 150,
};

/**
 * Fraction of a cooked dish's weight that is protein + carbs + fat. The rest
 * is water and fibre. ~35% matches typical home-cooked mixed meals and gives a
 * far better mass estimate than assuming everything weighs 100g.
 */
const DRY_MATTER = 0.35;

/** Energy density of mixed cooked food, for entries that only recorded kcal. */
const KCAL_PER_GRAM = 1.5;

export interface Macros {
  calories: number;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
}

/** Rounds to a weight a person would actually type. */
function tidy(grams: number): number {
  const g = Math.min(5000, Math.max(5, grams));
  return g >= 100 ? Math.round(g / 10) * 10 : Math.round(g / 5) * 5;
}

/**
 * Converts a recorded portion to grams. Returns null when the unit isn't a
 * measure we can weigh ("serving", "portion", or nothing at all).
 */
export function toGrams(quantity: number | null | undefined, unit: string | null | undefined): number | null {
  if (!quantity || quantity <= 0) return null;
  const key = String(unit ?? '').trim().toLowerCase().replace(/[.\s]/g, '').replace(/s$/, '');
  const per = UNIT_GRAMS[key] ?? UNIT_GRAMS[`${key}s`] ?? UNIT_GRAMS[String(unit ?? '').trim().toLowerCase()];
  return per ? tidy(quantity * per) : null;
}

/**
 * Best guess at what a portion weighed, for rows logged before grams were
 * recorded. Macro mass is the stronger signal; calories are the fallback.
 */
export function estimateGrams(macros: Macros): number {
  const dry = (macros.protein_g ?? 0) + (macros.carbs_g ?? 0) + (macros.fat_g ?? 0);
  if (dry > 0) return tidy(dry / DRY_MATTER);
  if (macros.calories > 0) return tidy(macros.calories / KCAL_PER_GRAM);
  return 100;
}

export interface PortionBasis {
  /** Weight of the portion as logged. */
  grams: number;
  /** False when the weight was inferred rather than recorded. */
  exact: boolean;
}

/** Gram basis for anything holding a portion plus its macros. */
export function portionBasis(
  macros: Macros,
  quantity: number | null | undefined,
  unit: string | null | undefined
): PortionBasis {
  const recorded = toGrams(quantity, unit);
  if (recorded != null) return { grams: recorded, exact: true };
  return { grams: estimateGrams(macros), exact: false };
}

/** A weighed portion and the macros it comes to. */
export interface Portion {
  grams: number;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

/**
 * The library food's usual portion, weighed. Used when a suggestion is tapped
 * straight from the list rather than opened in the portion sheet.
 */
export function defaultPortion(food: {
  reference_unit: string;
  default_quantity: number;
  calories_per_unit: number;
  protein_g_per_unit: number | null;
  carbs_g_per_unit: number | null;
  fat_g_per_unit: number | null;
}): Portion {
  const q = food.default_quantity || 1;
  const round = (v: number | null) => (v == null ? null : Math.round(v * q));
  const totals = {
    calories: Math.round(food.calories_per_unit * q),
    protein_g: round(food.protein_g_per_unit),
    carbs_g: round(food.carbs_g_per_unit),
    fat_g: round(food.fat_g_per_unit),
  };
  return { grams: portionBasis(totals, q, food.reference_unit).grams, ...totals };
}

/** Step size for the gram stepper — coarse enough to be usable by thumb. */
export function gramStep(grams: number): number {
  return grams >= 200 ? 25 : 10;
}

export function formatGrams(grams: number): string {
  return `${Math.round(grams)}g`;
}
