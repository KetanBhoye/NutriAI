import { parseISODate } from '@/dates';
import { WeighIn } from '@/types';

/**
 * The maths behind the daily weight chart, kept out of the component so it can
 * be tested. The chart is only lines and circles; these are the numbers.
 */

/** Window for the smoothed line — matches the server's own trend window. */
export const SMOOTH_DAYS = 7;

export interface TrendPoint {
  /** Days since the plan's start date. */
  day: number;
  kg: number;
}

export function dayOffset(from: string, to: string): number {
  return Math.round((parseISODate(to).getTime() - parseISODate(from).getTime()) / 86_400_000);
}

/**
 * Weigh-ins as day-offsets from the plan's start, oldest first.
 *
 * Readings from before the plan began are dropped rather than plotted at a
 * negative offset, which would run off the left of the chart.
 */
export function toTrendPoints(weighIns: WeighIn[], startDate: string): TrendPoint[] {
  return weighIns
    .map((w) => ({ day: dayOffset(startDate, w.recorded_date), kg: w.weight_kg }))
    .filter((p) => p.day >= 0)
    .sort((a, b) => a.day - b.day);
}

/**
 * Each reading averaged with the week before it.
 *
 * A daily weight swings up to a kilo on salt, sleep and time of day, so the raw
 * points say nothing on their own — the smoothed line is the one to read. The
 * window is trailing, so the line never uses information from the future.
 */
export function smoothSeries(points: TrendPoint[]): TrendPoint[] {
  return points.map((p, i) => {
    const window = points.slice(0, i + 1).filter((q) => p.day - q.day < SMOOTH_DAYS);
    return { day: p.day, kg: window.reduce((s, q) => s + q.kg, 0) / window.length };
  });
}

/** The plan's straight line, evaluated at a day offset. */
export function baselineAt(
  startWeightKg: number,
  goalWeightKg: number,
  totalDays: number,
  day: number
): number {
  if (totalDays <= 0) return goalWeightKg;
  const clamped = Math.min(Math.max(day, 0), totalDays);
  return startWeightKg + ((goalWeightKg - startWeightKg) * clamped) / totalDays;
}
