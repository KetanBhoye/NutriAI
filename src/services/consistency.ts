/**
 * The consistency score: one number for "how well did I stick to my plan this
 * week", plus an honest sense of where that sits.
 *
 * ── Why it scores behaviour, not results ──────────────────────────────────
 * Nothing here looks at weight change. Weight moves with water, sodium, gut
 * content and genetics, and a week of perfect adherence can still show a gain.
 * Scoring the outcome would hand the worst number to someone who did
 * everything asked of them, which is both unfair and the fastest way to make
 * them stop opening the app. Everything below is a choice the user makes.
 *
 * ── Why credit is graded, not pass/fail ───────────────────────────────────
 * Research on fitness apps (UCL's analysis of ~60k user posts) found shame,
 * guilt and disengagement clustering around *rigid* targets — the all-or-
 * nothing framing, more than the target itself. So 95% of your protein goal
 * scores 95%, not zero, and small misses cost small amounts.
 *
 * ── Why comparison is a share, not a rank ─────────────────────────────────
 * "More consistent than 72% of members" is information. "#4,182 of 30,000" is
 * a leaderboard, and the same research found ranking backfires hardest for the
 * people most likely to quit. The comparison is also *suppressed* when it
 * would be discouraging — see `shouldShowComparison`. A user below the 25th
 * percentile is told nothing about others; they get their own trend instead,
 * which is the number they can actually move.
 *
 * ── Why no AI ─────────────────────────────────────────────────────────────
 * Same arithmetic for everybody, every time. A model would produce a different
 * number for identical weeks, and a score that moves on its own is worthless
 * for comparing to yourself last week — which is the whole point.
 */

/** Monday-to-Sunday, matching the weekly report and the Sunday insights badge. */
export const WEEK_LENGTH_DAYS = 7;

/**
 * A day's worth of what we track. Everything is optional because a goal that
 * was never set must not count against the user (see `scoreDay`).
 */
export interface DayInput {
  date: string;
  /** Total kcal logged. 0 or absent means the day was not logged. */
  calories: number;
  proteinG: number;
  steps?: number | null;
}

export interface Targets {
  calories: number;
  /** Absent or 0 when the user has no protein goal; protein then does not count. */
  proteinG?: number | null;
  /** Absent when the user has no step goal; movement then does not count. */
  stepGoal?: number | null;
}

/**
 * Below this a day is not a real log — a single 240 kcal coffee entry is not
 * a tracked day, and treating it as one would let someone score well for
 * logging almost nothing. Matches services/streak.ts.
 */
export const COMPLETE_DAY_KCAL = 1200;

/**
 * Weights out of 100. Logging carries the most because it is the gateway
 * behaviour — nothing else can be measured on a day that was never recorded,
 * and it is the habit the app most needs to build.
 */
const WEIGHTS = {
  logging: 35,
  calories: 25,
  protein: 20,
  movement: 20,
} as const;

export interface DayScore {
  date: string;
  logged: boolean;
  logging: number;
  calories: number;
  protein: number | null;
  movement: number | null;
  /** 0–100 for this day. */
  total: number;
}

/**
 * Linear falloff from full credit to none.
 * `at(full) = 1`, `at(zero) = 0`, clamped outside.
 */
function ramp(value: number, zero: number, full: number): number {
  if (full === zero) return value >= full ? 1 : 0;
  const t = (value - zero) / (full - zero);
  return Math.max(0, Math.min(1, t));
}

/**
 * Calorie adherence, symmetric around the target.
 *
 * Full credit within ±10% — that band is narrower than the error in the
 * calorie numbers themselves, so demanding better would be scoring noise.
 * Credit then falls to zero at ±40%. Under-eating is penalised as much as
 * over-eating: a very low day is a red flag, not a win, and rewarding it
 * would teach exactly the wrong habit.
 */
export function calorieAdherence(calories: number, target: number): number {
  if (target <= 0) return 0;
  const deviation = Math.abs(calories - target) / target;
  return ramp(deviation, 0.4, 0.1);
}

/**
 * Protein credit. Hitting the goal is full marks and exceeding it is not extra
 * credit — there is no prize for 200% of target, and offering one would push
 * people toward a number that is not the goal.
 */
export function proteinAdherence(proteinG: number, target: number): number {
  if (target <= 0) return 0;
  return ramp(proteinG / target, 0.5, 1);
}

/** Steps, with half the goal as the point where credit starts. */
export function movementAdherence(steps: number, goal: number): number {
  if (goal <= 0) return 0;
  return ramp(steps / goal, 0.4, 1);
}

export function scoreDay(day: DayInput, targets: Targets): DayScore {
  const logged = day.calories >= COMPLETE_DAY_KCAL;

  // An unlogged day scores zero everywhere rather than being skipped. Skipping
  // it would mean someone who logged one perfect day and nothing else scored
  // 100, which is the opposite of consistency.
  if (!logged) {
    return {
      date: day.date,
      logged: false,
      logging: 0,
      calories: 0,
      protein: targets.proteinG ? 0 : null,
      movement: targets.stepGoal ? 0 : null,
      total: 0,
    };
  }

  const calories = calorieAdherence(day.calories, targets.calories);

  // Protein and movement are both optional, and for the same reason: a goal
  // the user was never asked to set must not be scored as a goal they missed.
  // Getting this wrong is invisible in the total — it just quietly caps
  // everyone without that goal at a lower ceiling.
  const hasProteinGoal = Boolean(targets.proteinG && targets.proteinG > 0);
  const protein = hasProteinGoal ? proteinAdherence(day.proteinG, targets.proteinG!) : null;
  const hasStepGoal = Boolean(targets.stepGoal && targets.stepGoal > 0);
  const movement = hasStepGoal ? movementAdherence(day.steps ?? 0, targets.stepGoal!) : null;

  // Weights renormalise over the components that apply.
  let earned = WEIGHTS.logging + calories * WEIGHTS.calories;
  let available = WEIGHTS.logging + WEIGHTS.calories;
  if (protein !== null) {
    earned += protein * WEIGHTS.protein;
    available += WEIGHTS.protein;
  }
  if (movement !== null) {
    earned += movement * WEIGHTS.movement;
    available += WEIGHTS.movement;
  }

  return {
    date: day.date,
    logged: true,
    logging: 1,
    calories,
    protein,
    movement,
    total: (earned / available) * 100,
  };
}

export interface WeekScore {
  /** 0–100, rounded. */
  score: number;
  daysLogged: number;
  days: DayScore[];
  /** Per-component averages across the week, for the breakdown UI. */
  components: {
    logging: number;
    calories: number;
    protein: number | null;
    movement: number | null;
  };
}

/**
 * Scores a week. `days` should hold every calendar day in the week, including
 * the ones with nothing logged — a caller that passes only logged days will
 * get a flattering score, because the misses are what the metric is about.
 */
export function scoreWeek(days: DayInput[], targets: Targets): WeekScore {
  if (days.length === 0) {
    return {
      score: 0,
      daysLogged: 0,
      days: [],
      components: { logging: 0, calories: 0, protein: null, movement: null },
    };
  }

  const scored = days.map((d) => scoreDay(d, targets));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const present = (pick: (d: DayScore) => number | null) =>
    scored.map(pick).filter((v): v is number => v !== null);
  const proteinScores = present((d) => d.protein);
  const movementScores = present((d) => d.movement);

  return {
    score: Math.round(mean(scored.map((d) => d.total))),
    daysLogged: scored.filter((d) => d.logged).length,
    days: scored,
    components: {
      logging: Math.round(mean(scored.map((d) => d.logging)) * 100),
      calories: Math.round(mean(scored.map((d) => d.calories)) * 100),
      protein: proteinScores.length ? Math.round(mean(proteinScores) * 100) : null,
      movement: movementScores.length ? Math.round(mean(movementScores) * 100) : null,
    },
  };
}

/**
 * The share of members this score beats, 0–100.
 *
 * Ties count as half, so a population where everyone scores the same puts each
 * of them at 50 rather than at 0 or 100 depending on comparison order.
 */
export function percentileOf(score: number, population: number[]): number {
  if (population.length === 0) return 50;
  let below = 0;
  let equal = 0;
  for (const other of population) {
    if (other < score) below += 1;
    else if (other === score) equal += 1;
  }
  return Math.round(((below + equal / 2) / population.length) * 100);
}

/**
 * Too small a population and the number is meaningless — with four other
 * members, "better than 75%" is one person having an off week.
 */
export const MIN_POPULATION = 20;

/** Fewer logged days than this and the user's own score is noise, not a signal. */
export const MIN_DAYS_FOR_COMPARISON = 3;

/**
 * Below this we say nothing about other people.
 *
 * The deliberate asymmetry: being told you are ahead of most members is
 * motivating, being told you are behind nearly all of them is the shame
 * finding in the research. Someone in the bottom quarter is the *most* likely
 * to quit and the least helped by hearing it, so they get their own trend
 * instead — the number they can actually move.
 */
export const COMPARISON_FLOOR_PERCENTILE = 25;

export function shouldShowComparison(
  percentile: number,
  populationSize: number,
  daysLogged: number
): boolean {
  return (
    populationSize >= MIN_POPULATION &&
    daysLogged >= MIN_DAYS_FOR_COMPARISON &&
    percentile >= COMPARISON_FLOOR_PERCENTILE
  );
}

export type ScoreBand = 'building' | 'steady' | 'strong' | 'excellent';

/**
 * Bands exist so the copy can be encouraging at every level. Note the lowest
 * is "building", not "poor" — a label a user reads about themselves should
 * describe a direction, not a verdict.
 */
export function bandFor(score: number): ScoreBand {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'strong';
  if (score >= 45) return 'steady';
  return 'building';
}

export interface ConsistencyHeadline {
  band: ScoreBand;
  title: string;
  detail: string;
}

/**
 * The sentence under the number. Always self-referential first: the comparison
 * is a footnote, never the headline.
 */
export function headlineFor(
  score: number,
  previous: number | null,
  personalBest: number | null
): ConsistencyHeadline {
  const band = bandFor(score);
  const isBest = personalBest !== null && score >= personalBest && score > 0;

  if (isBest) {
    return {
      band,
      title: 'Your best week yet',
      detail: `${score} out of 100 — no week has been steadier than this one.`,
    };
  }

  if (previous !== null && score > previous) {
    return {
      band,
      title: 'Up on last week',
      detail: `${score} out of 100, ${score - previous} better than last week.`,
    };
  }

  if (previous !== null && score < previous) {
    // Named plainly, without scolding, and pointed forward.
    return {
      band,
      title: 'A quieter week',
      detail: `${score} out of 100. Last week was ${previous} — one more logged day usually closes that gap.`,
    };
  }

  const detail: Record<ScoreBand, string> = {
    excellent: `${score} out of 100. You are doing what the plan asks, almost every day.`,
    strong: `${score} out of 100. The habit is holding.`,
    steady: `${score} out of 100. The days you log look good — more of them is the whole trick.`,
    building: `${score} out of 100. Early days. Logging one more day this week moves this more than anything else.`,
  };

  return { band, title: 'This week', detail: detail[band] };
}

/**
 * The Monday of the week containing `date`, as `YYYY-MM-DD`.
 *
 * String arithmetic in UTC, never `toISOString()` on a local Date — the same
 * bug that made streaks read one short for +05:30 users every morning
 * (services/streak.ts). A week boundary computed in the wrong timezone moves
 * someone's whole score by a day.
 */
export function weekStartFor(date: string): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) return date;
  const d = new Date(ms);
  // getUTCDay: Sunday = 0. Shift so Monday = 0.
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

/** The seven `YYYY-MM-DD` dates of the week beginning `weekStart`. */
export function weekDays(weekStart: string): string[] {
  const ms = Date.parse(`${weekStart}T00:00:00Z`);
  return Array.from({ length: WEEK_LENGTH_DAYS }, (_, i) =>
    new Date(ms + i * 86_400_000).toISOString().slice(0, 10)
  );
}

/** `2026-08-10` → `2026-08-03`. */
export function previousWeekStart(weekStart: string): string {
  return new Date(Date.parse(`${weekStart}T00:00:00Z`) - 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
