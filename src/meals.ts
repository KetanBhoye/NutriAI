import { FoodEntry, MealType, Totals } from '@/types';

/**
 * The day's log, reduced.
 *
 * Extracted from the Today screen so the arithmetic behind the ring, the macro
 * bar and the meal sections can be tested without a renderer — these are the
 * numbers the whole screen is about.
 */

export const MEALS: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/**
 * The meal a fresh log most likely belongs to, by the clock. Boundaries are
 * deliberately generous at both ends: a 22:30 meal is a snack, not tomorrow's
 * breakfast.
 */
export function currentMeal(now: Date = new Date()): MealType {
  const hour = now.getHours();
  if (hour < 11) return 'breakfast';
  if (hour < 16) return 'lunch';
  if (hour < 21) return 'dinner';
  return 'snack';
}

export function emptyTotals(): Totals {
  return { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
}

/** Missing macros count as zero — an unknown protein is not a negative one. */
export function sumTotals(entries: FoodEntry[]): Totals {
  return entries.reduce<Totals>(
    (acc, e) => ({
      calories: acc.calories + e.calories,
      protein_g: acc.protein_g + (e.protein_g ?? 0),
      carbs_g: acc.carbs_g + (e.carbs_g ?? 0),
      fat_g: acc.fat_g + (e.fat_g ?? 0),
    }),
    emptyTotals()
  );
}

/**
 * Groups entries under their meal. Rows with no meal (the coach and some older
 * imports don't always set one) are left out rather than dumped into snack,
 * which would silently move someone's dinner.
 */
export function groupByMeal(entries: FoodEntry[]): Record<MealType, FoodEntry[]> {
  const grouped: Record<MealType, FoodEntry[]> = { breakfast: [], lunch: [], dinner: [], snack: [] };
  for (const e of entries) if (e.meal_type) grouped[e.meal_type].push(e);
  return grouped;
}

/** Never negative: going over target reads as 0 left, not as a debt. */
export function remainingCalories(goal: number, consumed: number): number {
  return Math.max(0, goal - consumed);
}
