/**
 * Client-side nutrition math for the onboarding wizard.
 *
 * The numbers are computed live so the wizard feels instant; the server
 * recomputes/validates on save and (when Vertex is configured) refines them
 * into a personalised plan. Formulas match src/utils/calculations.ts
 * (Mifflin-St Jeor BMR + activity multipliers) so client and server agree.
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

export const ACTIVITY: Record<ActivityLevel, { label: string; hint: string; mult: number }> = {
  sedentary: { label: 'Sedentary', hint: 'Desk job, little exercise', mult: 1.2 },
  light: { label: 'Lightly active', hint: 'Light exercise 1–3 days/week', mult: 1.375 },
  moderate: { label: 'Moderately active', hint: 'Exercise 3–5 days/week', mult: 1.55 },
  active: { label: 'Very active', hint: 'Hard exercise 6–7 days/week', mult: 1.725 },
  very_active: { label: 'Athlete', hint: 'Training twice a day / physical job', mult: 1.9 },
};

export const GOALS: Record<
  Goal,
  { label: string; blurb: string; calorieFactor: number; proteinPerKg: number; fatPct: number }
> = {
  cut: {
    label: 'Cut',
    blurb: 'Lose fat while keeping muscle',
    calorieFactor: 0.8, // ~20% deficit
    proteinPerKg: 2.2, // high protein protects muscle in a deficit
    fatPct: 0.25,
  },
  maintain: {
    label: 'Maintain',
    blurb: 'Hold your weight, recomp slowly',
    calorieFactor: 1.0,
    proteinPerKg: 1.8,
    fatPct: 0.28,
  },
  lean_bulk: {
    label: 'Lean bulk',
    blurb: 'Slow muscle gain, minimal fat',
    calorieFactor: 1.08, // ~8% surplus
    proteinPerKg: 2.0,
    fatPct: 0.25,
  },
  bulk: {
    label: 'Bulk',
    blurb: 'Faster muscle & strength gain',
    calorieFactor: 1.15, // ~15% surplus
    proteinPerKg: 1.8,
    fatPct: 0.25,
  },
};

/** Mifflin-St Jeor basal metabolic rate. */
export function calcBMR(weightKg: number, heightCm: number, age: number, gender: Gender): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return Math.round(gender === 'male' ? base + 5 : base - 161);
}

/** Total daily energy expenditure — maintenance calories. */
export function calcTDEE(bmr: number, activity: ActivityLevel): number {
  return Math.round(bmr * ACTIVITY[activity].mult);
}

/** Turns a maintenance figure + goal into daily calorie and macro targets. */
export function computeMacros(tdee: number, weightKg: number, goal: Goal): Macros {
  const g = GOALS[goal];
  const calories = Math.max(1000, Math.round((tdee * g.calorieFactor) / 10) * 10);
  const protein_g = Math.round(weightKg * g.proteinPerKg);
  const fat_g = Math.round((calories * g.fatPct) / 9);
  const carbs_g = Math.max(0, Math.round((calories - protein_g * 4 - fat_g * 9) / 4));
  return { calories, protein_g, carbs_g, fat_g };
}
