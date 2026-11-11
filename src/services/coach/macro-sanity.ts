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
 * The estimation rules shared by every prompt that guesses macros: the food-log
 * parser, the photo parser, the grounded lookup and the coach itself. Kept in
 * one place so they can't drift into disagreeing about the same plate of food.
 *
 * Two halves, and the split matters.
 *
 * The first is a method, because accuracy here is arithmetic rather than
 * recall: amount in grams, value per 100 g for the food as eaten, multiply,
 * add the cooking fat, check the result against itself. A model that skips
 * straight to "a bowl of dal is 180 kcal" is the model that gets it wrong.
 *
 * The second is the lean-low rule for portions nobody stated. It is scoped to
 * guessed amounts on purpose: shading down "150 g paneer" is not caution, it
 * is just an error, and it used to apply to everything.
 *
 * The anchors are ordinary Indian home portions — the case the models get most
 * wrong, because their training data is weighted towards restaurant and US
 * serving sizes. Each row is internally consistent (protein×4 + carbs×4 +
 * fat×9 lands on its calories), since a model scales from these.
 */
export const CONSERVATIVE_ESTIMATION_RULES = `HOW TO WORK OUT MACROS — for every item, in this order:
1. Pin down the amount in grams or millilitres. A weight, a count or a pack size the user stated IS the amount: use it exactly. Only a vague measure ("a bowl", "some", "a plate", anything judged from a photo) is estimated, using the reference portions below.
2. Take the values for that food AS EATEN. Cooked and raw are different foods: cooked rice is about 130 kcal per 100 g, raw rice about 350. Assume cooked / ready-to-eat unless the user says raw, dry or uncooked.
3. Multiply up. Calories and macros are for the TOTAL amount eaten, never per 100 g.
4. Add the cooking fat the dish really contains: a tadka, shallow or deep frying, ghee on a roti, butter on toast. Count it when the user mentions it or the dish cannot be made without it. 1 tsp oil or ghee = 45 kcal, 5 g fat. Add none to boiled, steamed, roasted or raw food.
5. Check yourself: protein×4 + carbs×4 + fat×9 must land within about 10% of the calories and must not exceed them. If it does not, one number is wrong — find it and fix it. Do not just nudge the total.

Packaged and branded food: use that exact product's label values for the amount eaten when you know them. If you do not know the product, use a typical value for that kind of food — never another brand's figures presented as this one's.
Composite dishes: work them out from their parts (the grain, the protein, the vegetables, the fat), not from a remembered total for the dish name.

WHEN THE AMOUNT IS A GUESS — under-estimating is acceptable, over-estimating is not:
- When a portion could plausibly be a range, take the LOWER end. Do not round up.
- Judge the portion from what is visible or described, not from what a restaurant would serve. Home portions are smaller.
- Protein is the number most often overstated. Vegetarian Indian food is low in protein: unless the dish is meat, fish, eggs, paneer, soya or a protein supplement, protein is small.
- Count only the food, not the plate, garnish or serving dish.
- This leaning applies to guessed amounts only. An amount the user stated is never shaded down.

Reference values (ordinary home servings — scale from these rather than guessing):
- Roti / chapati, 1 medium, no ghee: 100 kcal, 3 g protein, 18 g carbs, 2 g fat
- Plain paratha, 1 medium: 190 kcal, 4 g protein, 27 g carbs, 7 g fat
- Cooked rice, 1 katori (150 g): 200 kcal, 4 g protein, 44 g carbs, 0.5 g fat
- Dal, 1 katori (150 g): 120 kcal, 6 g protein, 18 g carbs, 3 g fat
- Rajma / chole, 1 katori (150 g): 180 kcal, 9 g protein, 25 g carbs, 5 g fat
- Sambar, 1 katori (150 g): 90 kcal, 4 g protein, 13 g carbs, 2.5 g fat
- Mixed veg sabzi, 1 katori: 110 kcal, 3 g protein, 12 g carbs, 6 g fat
- Curd / dahi, 1 katori (150 g): 90 kcal, 5 g protein, 7 g carbs, 5 g fat
- Toned milk, 1 glass (200 ml): 120 kcal, 6 g protein, 10 g carbs, 6 g fat
- Chai with milk and sugar, 1 cup: 70 kcal, 2 g protein, 10 g carbs, 2.5 g fat
- Paneer, 100 g: 290 kcal, 18 g protein, 4 g carbs, 22 g fat
- Egg, 1 whole, boiled: 78 kcal, 6 g protein, 0.6 g carbs, 5 g fat
- Chicken breast, cooked, 100 g: 165 kcal, 31 g protein, 0 g carbs, 3.6 g fat
- Chicken curry, 1 katori (~100 g meat): 200 kcal, 18 g protein, 5 g carbs, 12 g fat
- Soya chunks, dry, 50 g: 172 kcal, 26 g protein, 16 g carbs, 0.5 g fat
- Whey protein, 1 scoop (30 g): 120 kcal, 24 g protein, 3 g carbs, 1.5 g fat
- Idli, 1: 60 kcal, 2 g protein, 12 g carbs, 0.3 g fat
- Dosa, 1 plain: 130 kcal, 3 g protein, 20 g carbs, 4 g fat
- Poha, 1 plate (150 g cooked): 250 kcal, 5 g protein, 42 g carbs, 7 g fat
- Oats, dry, 40 g: 155 kcal, 6.5 g protein, 26 g carbs, 2.8 g fat
- Bread, 1 slice: 70 kcal, 2.5 g protein, 13 g carbs, 1 g fat
- Boiled potato, 100 g: 87 kcal, 2 g protein, 20 g carbs, 0.1 g fat
- Banana, 1 medium: 105 kcal, 1.3 g protein, 24 g carbs, 0.4 g fat
- Peanuts, 30 g: 175 kcal, 7.5 g protein, 5 g carbs, 14 g fat
- Oil or ghee, 1 tsp (5 g): 45 kcal, 0 g protein, 0 g carbs, 5 g fat
- Sugar, 1 tsp (4 g): 16 kcal, 0 g protein, 4 g carbs, 0 g fat`;
