/**
 * Keeps AI-estimated macros from overstating a meal.
 *
 * Two habits show up in every vision/lookup model: portions get read as
 * restaurant-sized, and protein gets flattered — a plate of rice, dal and two
 * rotis comes back at 35 g. Both directions are not equally bad here. A user
 * who is shown a number lower than the truth eats a little more than the plan
 * and loses weight slightly slower; one who is shown a number higher than the
 * truth eats less than the plan believes, blows the day's budget on paper, and
 * stops trusting the app. So: under is survivable, over is not.
 *
 * This is the deterministic half of the fix (the prompts carry the other
 * half). It never invents food and never scales anything **up** — it only
 * removes the part of an estimate that the estimate itself contradicts.
 */

export interface Macros {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

/** Atwater factors: the energy the three macros actually carry. */
const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 } as const;

/**
 * How far the macros may exceed the stated calories before we treat them as
 * inflated. Some slack is honest — fibre, alcohol, rounding, and the fact that
 * food labels round every field independently.
 */
const TOLERANCE = 1.1;

export function macroEnergy(m: Pick<Macros, 'protein_g' | 'carbs_g' | 'fat_g'>): number {
  return (
    m.protein_g * KCAL_PER_G.protein + m.carbs_g * KCAL_PER_G.carbs + m.fat_g * KCAL_PER_G.fat
  );
}

const clean = (n: unknown): number => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
};

/**
 * Returns the estimate with its macros reconciled against its own calorie
 * figure.
 *
 * Only one direction is corrected. If the macros carry more energy than the
 * item claims to have, at least one of them is too big and everything is
 * scaled to fit. If they carry less, that is left alone: the gap is usually
 * fibre or an unlisted ingredient, and correcting it would mean inventing
 * protein — exactly what we're trying to stop.
 *
 * An item with no calorie figure gets one derived from its macros, because a
 * zero-calorie entry with 30 g of protein silently corrupts the day's totals.
 */
export function reconcileMacros(input: Macros): Macros {
  const m: Macros = {
    calories: clean(input.calories),
    protein_g: clean(input.protein_g),
    carbs_g: clean(input.carbs_g),
    fat_g: clean(input.fat_g),
  };

  const energy = macroEnergy(m);
  if (energy <= 0) return { ...m, protein_g: 0, carbs_g: 0, fat_g: 0 };

  if (m.calories <= 0) {
    return { ...m, calories: Math.round(energy) };
  }

  const ceiling = m.calories * TOLERANCE;
  if (energy <= ceiling) return m;

  // Scale to the calorie figure itself, not to the tolerance — landing exactly
  // on the limit would leave every corrected item at the top of its range,
  // which is the bias we're removing.
  const factor = m.calories / energy;
  return {
    calories: m.calories,
    protein_g: round1(m.protein_g * factor),
    carbs_g: round1(m.carbs_g * factor),
    fat_g: round1(m.fat_g * factor),
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The estimation rules shared by every prompt that guesses macros: the photo
 * parser, the grounded lookup and the coach itself. Kept in one place so the
 * three can't drift into disagreeing about the same plate of food.
 *
 * The anchors are ordinary Indian home portions — the case the models get most
 * wrong, because their training data is weighted towards restaurant and US
 * serving sizes.
 */
export const CONSERVATIVE_ESTIMATION_RULES = `ESTIMATION RULES — under-estimating is acceptable, over-estimating is not:
- When a portion could plausibly be a range, take the LOWER end. Do not round up.
- Judge the portion from what is visible, not from what a restaurant would serve. Home portions are smaller.
- Protein is the number most often overstated. Vegetarian Indian food is low in protein: unless the dish is meat, eggs, paneer, soya or a protein supplement, protein is small.
- Macros must be consistent with the calories: protein×4 + carbs×4 + fat×9 must not exceed the calorie figure. If they do, lower the macros, not raise the calories.
- Count only the food, not the plate, garnish or serving dish.

Reference portions (ordinary home servings — scale from these rather than guessing):
- Roti / chapati, 1 medium: 100 kcal, 3 g protein, 18 g carbs, 2 g fat
- Cooked rice, 1 katori (150 g): 200 kcal, 4 g protein, 44 g carbs, 0.5 g fat
- Dal, 1 katori (150 g): 120 kcal, 6 g protein, 18 g carbs, 3 g fat
- Mixed veg sabzi, 1 katori: 110 kcal, 3 g protein, 12 g carbs, 6 g fat
- Curd / dahi, 1 katori (150 g): 90 kcal, 5 g protein, 7 g carbs, 5 g fat
- Paneer, 100 g: 290 kcal, 18 g protein, 4 g carbs, 22 g fat
- Egg, 1 whole: 78 kcal, 6 g protein, 0.6 g carbs, 5 g fat
- Chicken curry, 1 katori (~100 g meat): 200 kcal, 18 g protein, 5 g carbs, 12 g fat
- Toned milk, 1 glass (200 ml): 120 kcal, 6 g protein, 10 g carbs, 6 g fat
- Idli, 1: 60 kcal, 2 g protein, 12 g carbs, 0.3 g fat
- Dosa, 1 plain: 130 kcal, 3 g protein, 20 g carbs, 4 g fat`;
