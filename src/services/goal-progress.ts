import type { GoalPlan } from '../repositories/goal-plan.repository.js';

export interface WeighIn {
  recorded_date: string;
  weight_kg: number | null;
}

export interface GlideWeek {
  week: number;
  date: string;
  target_kg: number;
  /** Actual weight for that week, if one was recorded near it. */
  actual_kg: number | null;
  status: 'ahead' | 'on' | 'watch' | 'behind' | 'empty';
}

/** Energy in a kilogram of body mass; the standard planning figure. */
export const KCAL_PER_KG = 7700;

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().split('T')[0]!;
}

function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  const a = Date.UTC(y1!, (m1 ?? 1) - 1, d1 ?? 1);
  const b = Date.UTC(y2!, (m2 ?? 1) - 1, d2 ?? 1);
  return Math.round((b - a) / 86_400_000);
}

function statusFor(
  actual: number | null,
  target: number,
  tolerance: number,
  losing: boolean
): GlideWeek['status'] {
  if (actual === null) return 'empty';

  // "Ahead" means further along the intended direction, which flips between a
  // cut and a bulk — comparing raw numbers would label a successful bulk as
  // failing.
  const delta = losing ? actual - target : target - actual;
  if (delta < -tolerance) return 'ahead';
  if (delta <= tolerance) return 'on';
  if (delta <= tolerance * 2) return 'watch';
  return 'behind';
}

/**
 * Builds the weekly glide path and matches each week to the nearest weigh-in.
 *
 * Weigh-ins rarely land exactly on a week boundary, so each week claims the
 * closest reading within ±3 days. Beyond that the week is left empty rather
 * than borrowing a stale number, which would flatter or punish a week that was
 * never actually measured.
 */
export function buildGlidePath(plan: GoalPlan, weighIns: WeighIn[]): GlideWeek[] {
  const totalDays = daysBetween(plan.start_date, plan.target_date);
  if (totalDays <= 0) return [];

  const weeks = Math.max(1, Math.ceil(totalDays / 7));
  const losing = plan.goal_weight_kg < plan.start_weight_kg;
  const perWeek = (plan.goal_weight_kg - plan.start_weight_kg) / weeks;

  const readings = weighIns
    .filter((w): w is WeighIn & { weight_kg: number } => w.weight_kg !== null)
    .sort((a, b) => a.recorded_date.localeCompare(b.recorded_date));

  const path: GlideWeek[] = [];

  for (let week = 0; week <= weeks; week += 1) {
    const date = week === weeks ? plan.target_date : addDays(plan.start_date, week * 7);
    const target =
      week === weeks
        ? plan.goal_weight_kg
        : Math.round((plan.start_weight_kg + perWeek * week) * 100) / 100;

    let actual: number | null = null;
    let closest = Number.POSITIVE_INFINITY;
    for (const reading of readings) {
      const distance = Math.abs(daysBetween(date, reading.recorded_date));
      if (distance <= 3 && distance < closest) {
        closest = distance;
        actual = reading.weight_kg;
      }
    }

    path.push({
      week,
      date,
      target_kg: target,
      actual_kg: actual,
      status: statusFor(actual, target, plan.tolerance_kg, losing),
    });
  }

  return path;
}

export interface PlanProgress {
  /** The plan's own line, evaluated for today. */
  baseline_kg: number | null;
  /** Today's weight, averaged over the last week of readings to kill noise. */
  actual_kg: number | null;
  /** How many readings that average is built from. */
  readings_used: number;
  /**
   * Distance off plan, signed so positive is always *behind* — a cut that's
   * heavier than planned and a bulk that's lighter both read positive.
   */
  delta_kg: number | null;
  status: GlideWeek['status'];
  planned_rate_kg_per_week: number;
  /** Measured from the recent trend; null until there's enough to fit a line. */
  actual_rate_kg_per_week: number | null;
  /** The rate needed from today to still land on the goal on time. */
  required_rate_kg_per_week: number | null;
  /** Where the current trend puts you on the target date. */
  projected_kg_at_target: number | null;
  /** When the current trend would reach the goal — null if it never would. */
  projected_goal_date: string | null;
  /** Positive means the projection lands later than planned. */
  days_off_plan: number | null;
  /**
   * Daily calorie change that would close the gap between the measured rate
   * and the rate the plan now needs. Negative means eat less.
   */
  suggested_calorie_delta: number | null;
  days_elapsed: number;
  days_remaining: number;
  headline: string;
}

/** Weight on the plan's straight line for a given day. */
function baselineOn(plan: GoalPlan, date: string): number {
  const total = daysBetween(plan.start_date, plan.target_date);
  if (total <= 0) return plan.goal_weight_kg;
  const elapsed = Math.min(Math.max(daysBetween(plan.start_date, date), 0), total);
  return (
    Math.round((plan.start_weight_kg + ((plan.goal_weight_kg - plan.start_weight_kg) * elapsed) / total) * 100) /
    100
  );
}

/** Least-squares slope in kg/day over (day-offset, weight) pairs. */
function slopePerDay(points: Array<{ day: number; kg: number }>): number | null {
  if (points.length < 2) return null;
  const n = points.length;
  const meanX = points.reduce((s, p) => s + p.day, 0) / n;
  const meanY = points.reduce((s, p) => s + p.kg, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.day - meanX) * (p.kg - meanY);
    den += (p.day - meanX) ** 2;
  }
  return den === 0 ? null : num / den;
}

/** Rates below this are indistinguishable from day-to-day water weight. */
const FLAT_RATE_KG_PER_WEEK = 0.05;
/** Don't suggest a swing bigger than this; a plan that far off needs re-planning. */
const MAX_SUGGESTED_KCAL = 400;

/**
 * Compares the plan against what actually happened, day by day.
 *
 * The weekly glide path answers "was that week on target"; this answers "given
 * the trend, will the plan land, and what would fix it". Everything is derived
 * from a smoothed weight and a fitted rate rather than the last reading —
 * single weigh-ins swing a kilo on salt and sleep alone, and a plan that reacts
 * to that noise would tell you something different every morning.
 */
export function planProgress(plan: GoalPlan, weighIns: WeighIn[], today: string): PlanProgress {
  const losing = plan.goal_weight_kg < plan.start_weight_kg;
  const totalDays = Math.max(1, daysBetween(plan.start_date, plan.target_date));
  const daysElapsed = Math.min(Math.max(daysBetween(plan.start_date, today), 0), totalDays);
  const daysRemaining = Math.max(0, daysBetween(today, plan.target_date));
  const plannedRate = ((plan.goal_weight_kg - plan.start_weight_kg) / totalDays) * 7;

  const readings = weighIns
    .filter((w): w is WeighIn & { weight_kg: number } => w.weight_kg !== null)
    .filter((w) => w.recorded_date <= today)
    .sort((a, b) => a.recorded_date.localeCompare(b.recorded_date));

  const baseline = baselineOn(plan, today);

  // Smooth today's weight over the last week of readings. Falls back to the
  // most recent reading so a once-a-week weigher still gets a comparison.
  const recent = readings.filter((r) => daysBetween(r.recorded_date, today) <= 7);
  const smoothing = recent.length ? recent : readings.slice(-1);
  const actual = smoothing.length
    ? Math.round((smoothing.reduce((s, r) => s + r.weight_kg, 0) / smoothing.length) * 100) / 100
    : null;

  // Fit the trend over four weeks: long enough to see through a bad night,
  // short enough that a change of pace three weeks ago doesn't dominate.
  const trendPoints = readings
    .filter((r) => daysBetween(r.recorded_date, today) <= 28)
    .map((r) => ({ day: daysBetween(plan.start_date, r.recorded_date), kg: r.weight_kg }));
  const span = trendPoints.length
    ? trendPoints[trendPoints.length - 1]!.day - trendPoints[0]!.day
    : 0;
  // Two readings a day apart imply a 7 kg/week "trend"; require a real window.
  const perDay = span >= 7 ? slopePerDay(trendPoints) : null;
  const actualRate = perDay === null ? null : Math.round(perDay * 7 * 100) / 100;

  const delta =
    actual === null ? null : Math.round((losing ? actual - baseline : baseline - actual) * 100) / 100;
  const status = statusFor(actual, baseline, plan.tolerance_kg, losing);

  const requiredRate =
    actual === null || daysRemaining <= 0
      ? null
      : Math.round((((plan.goal_weight_kg - actual) / daysRemaining) * 7) * 100) / 100;

  let projectedAtTarget: number | null = null;
  let projectedGoalDate: string | null = null;
  let daysOffPlan: number | null = null;

  if (actual !== null && actualRate !== null) {
    projectedAtTarget = Math.round((actual + (actualRate / 7) * daysRemaining) * 10) / 10;

    const toGo = plan.goal_weight_kg - actual;
    const movingTowardGoal = Math.abs(actualRate) >= FLAT_RATE_KG_PER_WEEK && toGo / actualRate > 0;
    if (Math.abs(toGo) < 0.05) {
      projectedGoalDate = today;
      daysOffPlan = -daysRemaining;
    } else if (movingTowardGoal) {
      const days = Math.ceil(toGo / (actualRate / 7));
      projectedGoalDate = addDays(today, days);
      daysOffPlan = days - daysRemaining;
    }
  }

  let suggested: number | null = null;
  if (requiredRate !== null && actualRate !== null && daysRemaining >= 7) {
    const raw = ((requiredRate - actualRate) * KCAL_PER_KG) / 7;
    const clamped = Math.max(-MAX_SUGGESTED_KCAL, Math.min(MAX_SUGGESTED_KCAL, raw));
    const rounded = Math.round(clamped / 10) * 10;
    // Below ~50 kcal the change is inside the error of the food log itself.
    suggested = Math.abs(rounded) >= 50 ? rounded : 0;
  }

  return {
    baseline_kg: baseline,
    actual_kg: actual,
    readings_used: smoothing.length,
    delta_kg: delta,
    status,
    planned_rate_kg_per_week: Math.round(plannedRate * 100) / 100,
    actual_rate_kg_per_week: actualRate,
    required_rate_kg_per_week: requiredRate,
    projected_kg_at_target: projectedAtTarget,
    projected_goal_date: projectedGoalDate,
    days_off_plan: daysOffPlan,
    suggested_calorie_delta: suggested,
    days_elapsed: daysElapsed,
    days_remaining: daysRemaining,
    headline: headlineFor({ status, delta, actual, actualRate, daysOffPlan, daysRemaining, losing }),
  };
}

function headlineFor({
  status,
  delta,
  actual,
  actualRate,
  daysOffPlan,
  daysRemaining,
  losing,
}: {
  status: GlideWeek['status'];
  delta: number | null;
  actual: number | null;
  actualRate: number | null;
  daysOffPlan: number | null;
  daysRemaining: number;
  losing: boolean;
}): string {
  if (actual === null) return 'Log a weigh-in and this starts tracking against your plan.';
  if (status === 'empty') return 'No recent weigh-in to compare against the plan.';

  const off = delta === null ? '' : `${Math.abs(delta).toFixed(1)} kg `;
  const direction = losing ? 'lighter' : 'heavier';

  if (status === 'ahead') {
    return `${off}ahead of plan — you're ${direction} than today's target.`;
  }
  if (status === 'on') {
    return actualRate === null
      ? 'On plan. Keep weighing in and the trend will fill in.'
      : `On plan at ${Math.abs(actualRate).toFixed(2)} kg/week.`;
  }

  if (daysRemaining === 0) return `${off}off plan at the target date.`;
  if (daysOffPlan !== null && daysOffPlan > 0) {
    return `${off}behind — at this rate you'd reach the goal about ${daysOffPlan} days late.`;
  }
  return `${off}behind plan. Worth adjusting the target or the pace.`;
}

export interface DeficitDay {
  date: string;
  intake_kcal: number;
  /** TDEE from the profile, plus any active energy not already counted in it. */
  expenditure_kcal: number | null;
  deficit_kcal: number | null;
}

/**
 * Daily energy balance.
 *
 * Expenditure uses the recorded TDEE, which already includes typical activity.
 * Active energy from Apple Health is deliberately NOT added on top — doing so
 * double-counts the movement TDEE already assumes and inflates the deficit,
 * which is the single most common way this kind of tracker lies to you.
 */
export function buildDeficitSeries(
  intakeByDate: Map<string, number>,
  tdeeByDate: Map<string, number>,
  fallbackTdee: number | null
): DeficitDay[] {
  const days = [...intakeByDate.keys()].sort();

  return days.map((date) => {
    const intake = intakeByDate.get(date)!;

    // Carry the most recent TDEE at or before this day; body composition is
    // measured every few days, not daily.
    let tdee: number | null = fallbackTdee;
    let bestDate = '';
    for (const [recorded, value] of tdeeByDate) {
      if (recorded <= date && recorded > bestDate) {
        bestDate = recorded;
        tdee = value;
      }
    }

    return {
      date,
      intake_kcal: intake,
      expenditure_kcal: tdee,
      deficit_kcal: tdee === null ? null : Math.round(tdee - intake),
    };
  });
}

/** Groups deficit days into ISO weeks, reporting only weeks with real coverage. */
export function weeklyDeficit(
  days: DeficitDay[],
  minDaysPerWeek = 4
): Array<{ week_start: string; days_logged: number; total_deficit: number; projected_kg: number }> {
  const buckets = new Map<string, DeficitDay[]>();

  for (const day of days) {
    if (day.deficit_kcal === null) continue;
    const [y, m, d] = day.date.split('-').map(Number);
    const parsed = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
    // Monday-start weeks.
    const offset = (parsed.getUTCDay() + 6) % 7;
    parsed.setUTCDate(parsed.getUTCDate() - offset);
    const key = parsed.toISOString().split('T')[0]!;

    const bucket = buckets.get(key);
    if (bucket) bucket.push(day);
    else buckets.set(key, [day]);
  }

  return [...buckets.entries()]
    // A week with two logged days isn't a week — reporting it as one would
    // show a deficit that mostly reflects the days that went unlogged.
    .filter(([, bucket]) => bucket.length >= minDaysPerWeek)
    .map(([week_start, bucket]) => {
      const total = bucket.reduce((sum, day) => sum + (day.deficit_kcal ?? 0), 0);
      return {
        week_start,
        days_logged: bucket.length,
        total_deficit: Math.round(total),
        projected_kg: Math.round((total / KCAL_PER_KG) * 100) / 100,
      };
    })
    .sort((a, b) => a.week_start.localeCompare(b.week_start));
}
