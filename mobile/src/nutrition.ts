/**
 * Client-side nutrition math for the onboarding wizard and the Plan tab's
 * smart editor. Ported verbatim from the web app's web/src/nutrition.ts —
 * formulas match the backend's src/utils/calculations.ts (Mifflin-St Jeor
 * BMR + activity multipliers) so client and server agree.
 */

export type Gender = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type Goal = 'cut' | 'maintain' | 'lean_bulk' | 'bulk';

export interface Macros {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

/**
 * Stand-in targets for the brief window where the app has no real ones —
 * a cold start with no cached goals and a failed request.
 *
 * There is exactly one set of these on purpose. Today and Trends used to carry
 * their own (2000 vs 1900 kcal), so a user in that state watched Today count
 * down from one number while the Trends goal line sat at another.
 */
export const FALLBACK_GOALS: Macros = {
  calories: 2000,
  protein_g: 150,
  carbs_g: 200,
  fat_g: 65,
};

export const ACTIVITY: Record<ActivityLevel, { label: string; hint: string; mult: number }> = {
  sedentary: { label: 'Sedentary', hint: 'Desk job, little exercise', mult: 1.2 },
  light: { label: 'Lightly active', hint: 'Light exercise 1–3 days/week', mult: 1.375 },
  moderate: { label: 'Moderately active', hint: 'Exercise 3–5 days/week', mult: 1.55 },
  active: { label: 'Very active', hint: 'Hard exercise 6–7 days/week', mult: 1.725 },
  very_active: { label: 'Athlete', hint: 'Training twice a day / physical job', mult: 1.9 },
};

/** ~7700 kcal per kg of body fat — the basis for rate-based deficits/surpluses. */
export const KCAL_PER_KG = 7700;

export interface RateOption {
  kg: number; // weekly rate
  label: string;
  tag: string;
}

/** Weekly weight-change rates offered per goal (MyFitnessPal-style). */
export const RATE_OPTIONS: Record<Goal, RateOption[]> = {
  cut: [
    { kg: 0.5, label: '0.5 kg / week', tag: 'Gentle' },
    { kg: 0.7, label: '0.7 kg / week', tag: 'Standard' },
    { kg: 1.0, label: '1 kg / week', tag: 'Aggressive' },
  ],
  maintain: [],
  lean_bulk: [
    { kg: 0.2, label: '0.2 kg / week', tag: 'Lean' },
    { kg: 0.35, label: '0.35 kg / week', tag: 'Standard' },
  ],
  bulk: [
    { kg: 0.35, label: '0.35 kg / week', tag: 'Standard' },
    { kg: 0.5, label: '0.5 kg / week', tag: 'Fast' },
  ],
};

/** The default rate for a goal (the middle/standard option). */
export function defaultRate(goal: Goal): number {
  const opts = RATE_OPTIONS[goal];
  return opts.length ? opts[Math.min(1, opts.length - 1)]!.kg : 0;
}

/**
 * The offered rate closest to one a saved plan implies. A plan's own pace is a
 * continuous number (goal weight over target date), so it rarely equals a pill
 * exactly — snapping keeps the editor showing the pace you actually chose
 * instead of silently falling back to the default.
 */
export function nearestRate(goal: Goal, rateKgPerWeek: number): number {
  const opts = RATE_OPTIONS[goal];
  if (!opts.length) return 0;
  if (!Number.isFinite(rateKgPerWeek) || rateKgPerWeek <= 0) return defaultRate(goal);
  return opts.reduce((best, o) =>
    Math.abs(o.kg - rateKgPerWeek) < Math.abs(best.kg - rateKgPerWeek) ? o : best
  ).kg;
}

export const GOALS: Record<
  Goal,
  { label: string; blurb: string; dir: -1 | 0 | 1; proteinPerKg: number; fatPct: number }
> = {
  cut: {
    label: 'Cut',
    blurb: 'Lose fat while keeping muscle',
    dir: -1, // calorie deficit
    proteinPerKg: 2.2, // high protein protects muscle in a deficit
    fatPct: 0.25,
  },
  maintain: {
    label: 'Maintain',
    blurb: 'Hold your weight, recomp slowly',
    dir: 0,
    proteinPerKg: 1.8,
    fatPct: 0.28,
  },
  lean_bulk: {
    label: 'Lean bulk',
    blurb: 'Slow muscle gain, minimal fat',
    dir: 1, // small surplus
    proteinPerKg: 2.0,
    fatPct: 0.25,
  },
  bulk: {
    label: 'Bulk',
    blurb: 'Faster muscle & strength gain',
    dir: 1, // larger surplus
    proteinPerKg: 1.8,
    fatPct: 0.25,
  },
};

/** The daily calorie deficit/surplus a weekly rate implies. */
export function dailyDelta(rateKgPerWeek: number): number {
  return Math.round((rateKgPerWeek * KCAL_PER_KG) / 7);
}

/** Mifflin-St Jeor basal metabolic rate. */
export function calcBMR(weightKg: number, heightCm: number, age: number, gender: Gender): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return Math.round(gender === 'male' ? base + 5 : base - 161);
}

/** Total daily energy expenditure — maintenance calories. */
export function calcTDEE(bmr: number, activity: ActivityLevel): number {
  return Math.round(bmr * ACTIVITY[activity].mult);
}

/**
 * Turns maintenance + goal + chosen weekly rate into daily targets.
 * Calories = TDEE ∓ (rate × 7700 ÷ 7), floored at 1200 so a cut never goes
 * unsafely low. Rate is ignored for "maintain".
 */
export function computeMacros(
  tdee: number,
  weightKg: number,
  goal: Goal,
  rateKgPerWeek: number = defaultRate(goal)
): Macros {
  const g = GOALS[goal];
  const delta = g.dir === 0 ? 0 : dailyDelta(rateKgPerWeek) * g.dir;
  const calories = Math.max(1200, Math.round((tdee + delta) / 10) * 10);
  const protein_g = Math.round(weightKg * g.proteinPerKg);
  const fat_g = Math.round((calories * g.fatPct) / 9);
  const carbs_g = Math.max(0, Math.round((calories - protein_g * 4 - fat_g * 9) / 4));
  return { calories, protein_g, carbs_g, fat_g };
}
