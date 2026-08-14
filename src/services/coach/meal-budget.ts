/**
 * How big the next meal should be, and which suggestions actually qualify.
 *
 * This exists because "roughly fit the calories left" in a prompt is not a
 * constraint. The model was told the remaining total and left to interpret it,
 * so it returned the same mid-sized plates whether 1,900 kcal were left or 300
 * — which is the opposite of adaptive.
 *
 * So the band is computed here, stated to the model as explicit numbers, and
 * then *enforced* on the way back. Anything the prompt fails to achieve, the
 * filter still does.
 */

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'meal';

/**
 * Share of the day's REMAINING calories a given meal should take.
 *
 * Deliberately shares of what's left rather than of the daily goal: someone
 * opening this at 9pm with 400 kcal left needs a 400-kcal-shaped answer, not
 * the 700-kcal dinner their goal implies.
 */
const MEAL_SHARE: Record<MealType, number> = {
  breakfast: 0.3,
  lunch: 0.35,
  dinner: 0.35,
  snack: 0.15,
  meal: 0.3,
};

/** Below this a "meal" isn't worth suggesting as one; snacks can go lower. */
const MEAL_FLOOR: Record<MealType, number> = {
  breakfast: 200,
  lunch: 250,
  dinner: 250,
  snack: 100,
  meal: 200,
};

/** Under this much left, nothing normal fits — say so instead of pretending. */
const TIGHT_THRESHOLD = 150;

export interface CalorieBand {
  /** Smallest sensible suggestion, kcal. */
  min: number;
  /** Largest suggestion that still fits the day, kcal. */
  max: number;
  /** What to aim for, kcal. */
  target: number;
  /** Protein to aim for in this one meal, grams. Null when there's no goal. */
  proteinTarget: number | null;
  /** The day's calories are already spent. */
  overBudget: boolean;
  /** There's room, but only for something very light. */
  tight: boolean;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round10 = (n: number) => Math.round(n / 10) * 10;

/**
 * The calorie band for the next meal, or null when there's no goal to adapt to
 * (a user with no calorie target gets unconstrained suggestions, as before).
 */
export function mealCalorieBand(opts: {
  remainingCalories: number | null;
  remainingProtein: number | null;
  mealType: MealType;
}): CalorieBand | null {
  const { remainingCalories: remaining, remainingProtein, mealType } = opts;
  if (remaining == null || !Number.isFinite(remaining)) return null;

  const share = MEAL_SHARE[mealType] ?? MEAL_SHARE.meal;

  // Protein is the one target worth chasing even when calories are gone —
  // it's why someone over on calories might still want a lean option.
  const proteinTarget =
    remainingProtein != null && remainingProtein > 0
      ? Math.max(5, Math.round(remainingProtein * Math.max(share, 0.25)))
      : null;

  // Already over: the honest answer is "something very light, or nothing".
  if (remaining <= 0) {
    return { min: 0, max: 120, target: 60, proteinTarget, overBudget: true, tight: true };
  }

  if (remaining < TIGHT_THRESHOLD) {
    return {
      min: 0,
      max: round10(remaining),
      target: round10(remaining * 0.7),
      proteinTarget,
      overBudget: false,
      tight: true,
    };
  }

  // The floor can exceed the share when little is left (300 kcal at dinner
  // wants most of the 300, not 35% of it) — but never more than remains.
  const target = clamp(remaining * share, Math.min(MEAL_FLOOR[mealType], remaining), remaining);

  return {
    min: round10(clamp(target * 0.7, 50, remaining)),
    max: round10(clamp(target * 1.35, 60, remaining)),
    target: round10(target),
    proteinTarget,
    overBudget: false,
    tight: false,
  };
}

/** One line of instruction stating the band in numbers the model can hit. */
export function describeBand(band: CalorieBand | null, mealType: MealType): string {
  if (!band) return 'The user has no calorie target set, so suggest normally sized options.';

  if (band.overBudget) {
    return `The user has ALREADY MET their calorie target for today. Only suggest very light, low-calorie options (under ${band.max} kcal each) — things like a small bowl of curd, a piece of fruit, or black coffee. Say plainly in the description that this is a light top-up, not a meal.`;
  }

  const protein = band.proteinTarget ? ` Aim for at least ${band.proteinTarget}g protein in each.` : '';

  if (band.tight) {
    return `The user has only ${band.max} kcal left today. Every option MUST be under ${band.max} kcal — suggest small, light items, not full meals.${protein}`;
  }

  return `Every option MUST be between ${band.min} and ${band.max} kcal, ideally close to ${band.target} kcal, for this ${mealType}.${protein}`;
}

export interface Scored<T> {
  item: T;
  fits: boolean;
  distance: number;
}

/**
 * Picks the `count` best suggestions for the band.
 *
 * Asking the model for more than we need and choosing here is what makes the
 * result adaptive even when the model ignores the numbers — which it does,
 * especially at the extremes where adapting matters most.
 *
 * If anything fits the band, ONLY fitting options are shown — two good
 * suggestions beat three where one is a 900 kcal plate on a 300 kcal budget.
 * Padding the list with something that doesn't fit is precisely the behaviour
 * being complained about, and a short list is not a broken one.
 *
 * If nothing fits, the closest options are shown rather than an empty sheet:
 * the model misjudging every portion shouldn't leave the user with nothing.
 */
export function pickSuggestions<T extends { calories: number; name: string }>(
  suggestions: T[],
  band: CalorieBand | null,
  count = 3
): T[] {
  // Drop duplicate names first — the model repeats itself across a single
  // response often enough to waste a slot on it.
  const seen = new Set<string>();
  const unique = suggestions.filter((s) => {
    const key = s.name.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (!band) return unique.slice(0, count);

  const scored: Scored<T>[] = unique.map((item) => ({
    item,
    fits: item.calories >= band.min && item.calories <= band.max,
    distance: Math.abs(item.calories - band.target),
  }));

  scored.sort((a, b) => {
    if (a.fits !== b.fits) return a.fits ? -1 : 1;
    return a.distance - b.distance;
  });

  const fitting = scored.filter((s) => s.fits);
  const chosen = fitting.length ? fitting : scored;

  return chosen.slice(0, count).map((s) => s.item);
}
