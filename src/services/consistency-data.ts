import type { D1DatabaseCompat } from '../db/types.js';
import {
  percentileOf,
  previousWeekStart,
  scoreWeek,
  shouldShowComparison,
  weekDays,
  weekStartFor,
  type DayInput,
  type Targets,
  type WeekScore,
} from './consistency.js';

/**
 * Assembles the inputs the consistency score needs, for one user and for the
 * population it is compared against.
 *
 * All SQL here is dialect-free: bound date parameters, no `date('now', …)`,
 * no `julianday()`. Both are SQLite-only and both have already broken this
 * codebase once on Postgres.
 */

/** How many past weeks the sparkline shows, and the window for a personal best. */
export const HISTORY_WEEKS = 8;

interface DailyRow {
  entry_date: string;
  calories: number;
  protein_g: number | null;
}

interface StepRow {
  activity_date: string;
  steps: number | null;
}

async function targetsFor(db: D1DatabaseCompat, userId: string): Promise<Targets | null> {
  const prefs = await db
    .prepare(
      'SELECT daily_calorie_goal, daily_protein_goal_g FROM user_tracking_preferences WHERE user_id = ?'
    )
    .bind(userId)
    .first<{ daily_calorie_goal: number | null; daily_protein_goal_g: number | null }>();

  // Without a calorie goal there is nothing to be consistent *with*. Returning
  // null lets the endpoint say "finish setting up" rather than score them
  // against a number they never chose.
  if (!prefs?.daily_calorie_goal) return null;

  const plan = await db
    .prepare('SELECT daily_step_goal FROM goal_plans WHERE user_id = ? AND is_active = 1')
    .bind(userId)
    .first<{ daily_step_goal: number | null }>();

  return {
    calories: prefs.daily_calorie_goal,
    proteinG: prefs.daily_protein_goal_g ?? 0,
    stepGoal: plan?.daily_step_goal ?? null,
  };
}

/** Fills every calendar day in the range, so unlogged days score as misses. */
function buildDays(
  dates: string[],
  totals: Map<string, DailyRow>,
  steps: Map<string, number | null>
): DayInput[] {
  return dates.map((date) => ({
    date,
    calories: totals.get(date)?.calories ?? 0,
    proteinG: totals.get(date)?.protein_g ?? 0,
    steps: steps.get(date) ?? null,
  }));
}

export interface UserConsistency {
  weekStart: string;
  current: WeekScore;
  previousScore: number | null;
  personalBest: number | null;
  /** Oldest first, for a sparkline. */
  history: Array<{ weekStart: string; score: number }>;
  targets: Targets;
}

export async function getUserConsistency(
  db: D1DatabaseCompat,
  userId: string,
  today: string
): Promise<UserConsistency | null> {
  const targets = await targetsFor(db, userId);
  if (!targets) return null;

  const weekStart = weekStartFor(today);
  // One extra week back so the oldest history point still has a predecessor.
  const earliest = weekDays(weekStartFor(today))[0]!;
  const from = new Date(Date.parse(`${earliest}T00:00:00Z`) - HISTORY_WEEKS * 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const totals = await db
    .prepare(
      `SELECT entry_date, SUM(calories) AS calories, SUM(protein_g) AS protein_g
       FROM food_entries WHERE user_id = ? AND entry_date >= ?
       GROUP BY entry_date`
    )
    .bind(userId, from)
    .all<DailyRow>();

  const activity = await db
    .prepare(
      'SELECT activity_date, steps FROM daily_activity WHERE user_id = ? AND activity_date >= ?'
    )
    .bind(userId, from)
    .all<StepRow>();

  const totalsBy = new Map((totals.results ?? []).map((r) => [r.entry_date, r]));
  const stepsBy = new Map((activity.results ?? []).map((r) => [r.activity_date, r.steps]));

  const history: Array<{ weekStart: string; score: number }> = [];
  let cursor = weekStart;
  for (let i = 0; i < HISTORY_WEEKS; i += 1) {
    const scored = scoreWeek(buildDays(weekDays(cursor), totalsBy, stepsBy), targets);
    history.unshift({ weekStart: cursor, score: scored.score });
    cursor = previousWeekStart(cursor);
  }

  const current = scoreWeek(buildDays(weekDays(weekStart), totalsBy, stepsBy), targets);
  const past = history.slice(0, -1); // everything before this week

  return {
    weekStart,
    current,
    previousScore: past.length ? past[past.length - 1]!.score : null,
    // A "personal best" you are currently tied with should still read as one,
    // so this is the best of the *past* weeks and the caller compares with >=.
    personalBest: past.length ? Math.max(...past.map((w) => w.score)) : null,
    history,
    targets,
  };
}

/**
 * Everyone's score for a given week, for the percentile.
 *
 * Cached because this reads every active user's week. At 30k users that is
 * ~200k rows, which is fine hourly and not fine per request. The cache is
 * per-week, so it also self-expires when the week rolls over.
 */
const POPULATION_TTL_MS = 15 * 60 * 1000;
const populationCache = new Map<string, { at: number; scores: number[] }>();

/** Exposed for tests; a stale cache across test cases would be confusing. */
export function clearPopulationCache(): void {
  populationCache.clear();
}

export async function getPopulationScores(
  db: D1DatabaseCompat,
  weekStart: string
): Promise<number[]> {
  const cached = populationCache.get(weekStart);
  if (cached && Date.now() - cached.at < POPULATION_TTL_MS) return cached.scores;

  const dates = weekDays(weekStart);
  const first = dates[0]!;
  const last = dates[dates.length - 1]!;

  const totals = await db
    .prepare(
      `SELECT user_id, entry_date, SUM(calories) AS calories, SUM(protein_g) AS protein_g
       FROM food_entries WHERE entry_date >= ? AND entry_date <= ?
       GROUP BY user_id, entry_date`
    )
    .bind(first, last)
    .all<DailyRow & { user_id: string }>();

  const activity = await db
    .prepare(
      'SELECT user_id, activity_date, steps FROM daily_activity WHERE activity_date >= ? AND activity_date <= ?'
    )
    .bind(first, last)
    .all<StepRow & { user_id: string }>();

  const prefs = await db
    .prepare(
      'SELECT user_id, daily_calorie_goal, daily_protein_goal_g FROM user_tracking_preferences WHERE daily_calorie_goal IS NOT NULL'
    )
    .bind()
    .all<{ user_id: string; daily_calorie_goal: number; daily_protein_goal_g: number | null }>();

  const plans = await db
    .prepare('SELECT user_id, daily_step_goal FROM goal_plans WHERE is_active = 1')
    .bind()
    .all<{ user_id: string; daily_step_goal: number | null }>();

  const stepGoalBy = new Map((plans.results ?? []).map((p) => [p.user_id, p.daily_step_goal]));
  const totalsByUser = new Map<string, Map<string, DailyRow>>();
  for (const row of totals.results ?? []) {
    if (!totalsByUser.has(row.user_id)) totalsByUser.set(row.user_id, new Map());
    totalsByUser.get(row.user_id)!.set(row.entry_date, row);
  }
  const stepsByUser = new Map<string, Map<string, number | null>>();
  for (const row of activity.results ?? []) {
    if (!stepsByUser.has(row.user_id)) stepsByUser.set(row.user_id, new Map());
    stepsByUser.get(row.user_id)!.set(row.activity_date, row.steps);
  }

  const scores: number[] = [];
  for (const pref of prefs.results ?? []) {
    const userTotals = totalsByUser.get(pref.user_id) ?? new Map();
    // Someone who logged nothing all week is not "0th percentile", they are
    // not participating. Including them would inflate everyone else's standing
    // and make the comparison meaningless.
    if (userTotals.size === 0) continue;

    scores.push(
      scoreWeek(buildDays(dates, userTotals, stepsByUser.get(pref.user_id) ?? new Map()), {
        calories: pref.daily_calorie_goal,
        proteinG: pref.daily_protein_goal_g ?? 0,
        stepGoal: stepGoalBy.get(pref.user_id) ?? null,
      }).score
    );
  }

  populationCache.set(weekStart, { at: Date.now(), scores });
  return scores;
}

export interface Comparison {
  show: boolean;
  percentile: number;
  populationSize: number;
}

export async function compareToPopulation(
  db: D1DatabaseCompat,
  weekStart: string,
  score: number,
  daysLogged: number
): Promise<Comparison> {
  const population = await getPopulationScores(db, weekStart);
  const percentile = percentileOf(score, population);
  return {
    show: shouldShowComparison(percentile, population.length, daysLogged),
    percentile,
    populationSize: population.length,
  };
}
