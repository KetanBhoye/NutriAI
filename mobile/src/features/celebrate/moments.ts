import { MealType, Totals } from '@/types';

/**
 * What, if anything, is worth saying well done for.
 *
 * The failure mode of every celebration feature is volume. Congratulate
 * someone for logging a banana and the next real milestone means nothing —
 * the user has already learned to dismiss the thing without reading it. So
 * the rules here are deliberately mean:
 *
 *  - **At most one moment at a time.** If three things landed at once, the
 *    rarest wins and the others stay silent.
 *  - **Once, ever, per milestone.** A protein goal hit is celebrated the first
 *    time it happens that day and never again that day; a 7-day streak is
 *    celebrated once in a lifetime of that streak, not daily thereafter.
 *  - **Nothing for participation.** Logging a meal is not an achievement, it
 *    is the price of using the app. Achievements are targets *met*.
 *
 * Everything is derived from numbers the user was already watching, so the
 * copy can be specific. "128 g protein, your best this week" is worth reading;
 * "Great job!" is not, and after the second time it is an irritation.
 */

export type MomentKey =
  | 'protein-goal'
  | 'step-goal'
  | 'full-day'
  | 'streak-3'
  | 'streak-7'
  | 'streak-14'
  | 'streak-30'
  | 'weight-halfway'
  | 'weight-goal';

export interface Moment {
  key: MomentKey;
  title: string;
  detail: string;
  /**
   * How much noise it deserves. `major` gets the fuller treatment; `minor` is
   * a quieter nod. Nothing here is confetti.
   */
  weight: 'minor' | 'major';
}

export interface DayState {
  totals: Totals;
  proteinGoal: number | null;
  steps: number | null;
  stepGoal: number | null;
  loggedMeals: MealType[];
  /** Consecutive days with at least one entry, including today. */
  streakDays: number;
  /** Progress toward the plan, if there is one with a real target. */
  weight?: {
    startKg: number;
    goalKg: number;
    currentKg: number;
  } | null;
}

const round = (n: number) => Math.round(n);

/** Streak lengths worth marking, and what to call them. */
const STREAKS: Array<{ days: number; key: MomentKey; title: string }> = [
  { days: 30, key: 'streak-30', title: 'Thirty days straight' },
  { days: 14, key: 'streak-14', title: 'Two weeks straight' },
  { days: 7, key: 'streak-7', title: 'A full week logged' },
  { days: 3, key: 'streak-3', title: 'Three days running' },
];

/**
 * The one moment worth showing, or null.
 *
 * `alreadyShown` is every key already celebrated in the window that matters —
 * today's keys for the daily ones, all time for streaks and weight. The caller
 * owns that memory; this function stays pure so the rules can be tested
 * without a device.
 */
export function pickMoment(day: DayState, alreadyShown: Iterable<string>): Moment | null {
  const seen = new Set(alreadyShown);
  const candidates: Moment[] = [];

  // Rarest first — the order here is the priority when several land together.
  if (day.weight && day.weight.goalKg !== day.weight.startKg) {
    const total = Math.abs(day.weight.goalKg - day.weight.startKg);
    const done = Math.abs(day.weight.currentKg - day.weight.startKg);
    const reached =
      day.weight.goalKg < day.weight.startKg
        ? day.weight.currentKg <= day.weight.goalKg
        : day.weight.currentKg >= day.weight.goalKg;

    if (reached) {
      candidates.push({
        key: 'weight-goal',
        title: 'You hit your goal weight',
        detail: `${day.weight.goalKg.toFixed(1)} kg, from ${day.weight.startKg.toFixed(1)}. That was the whole plan.`,
        weight: 'major',
      });
    } else if (total > 0 && done / total >= 0.5) {
      candidates.push({
        key: 'weight-halfway',
        title: 'Halfway to your goal',
        detail: `${done.toFixed(1)} kg down, ${(total - done).toFixed(1)} to go.`,
        weight: 'major',
      });
    }
  }

  for (const streak of STREAKS) {
    if (day.streakDays >= streak.days) {
      candidates.push({
        key: streak.key,
        title: streak.title,
        detail: `${day.streakDays} days logged in a row. That is the habit doing the work.`,
        weight: 'major',
      });
      // Only the longest milestone reached matters.
      break;
    }
  }

  if (day.proteinGoal && day.totals.protein_g >= day.proteinGoal) {
    candidates.push({
      key: 'protein-goal',
      title: 'Protein target met',
      detail: `${round(day.totals.protein_g)} g today — the number most people miss.`,
      weight: 'minor',
    });
  }

  if (day.stepGoal && day.steps != null && day.steps >= day.stepGoal) {
    candidates.push({
      key: 'step-goal',
      title: 'Step goal reached',
      detail: `${day.steps.toLocaleString()} steps, past your ${day.stepGoal.toLocaleString()} target.`,
      weight: 'minor',
    });
  }

  const meals: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];
  const logged = new Set(day.loggedMeals);
  if (meals.filter((m) => logged.has(m)).length >= 4) {
    candidates.push({
      key: 'full-day',
      title: 'Every meal logged',
      detail: 'A complete day is what makes the plan adapt to you rather than guess.',
      weight: 'minor',
    });
  }

  return candidates.find((c) => !seen.has(c.key)) ?? null;
}

/**
 * Which keys reset daily and which never do.
 *
 * Streaks and weight milestones are once in a lifetime — celebrating "7-day
 * streak" every day from day seven onward is precisely how this feature turns
 * into wallpaper.
 */
export function isDailyMoment(key: MomentKey): boolean {
  return key === 'protein-goal' || key === 'step-goal' || key === 'full-day';
}
