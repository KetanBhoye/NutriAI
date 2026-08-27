import { addDays, todayISO } from '@/dates';

/**
 * Where a plan starts, and how far it has to go.
 *
 * A plan's start is one fact — a weight *on a date* — and the editor used to
 * split it in half. Saving an existing plan set `start_weight_kg` to whatever
 * the user weighs today while keeping `start_date` at the original date, so
 * the glide path was redrawn as if the kilos already lost had never been lost
 * and the clock had been running the whole time.
 *
 * Measured, on a plan that was very nearly on track: saving the editor without
 * changing anything moved the verdict from "0.32 kg off" to "1.15 kg behind
 * plan", and it compounded on every further save. It is the reason a person
 * who is tracking their plan is told they are not.
 *
 * So the two move together or not at all.
 */

export interface PlanStart {
  start_weight_kg: number;
  start_date: string;
}

/**
 * The start point to save.
 *
 * A brand-new plan starts today, obviously. An existing plan keeps its start —
 * that is the line the user has been weighing in against, and moving it would
 * throw the history away — *unless* the weight being planned from is no longer
 * the weight the plan started at. In that case the user is declaring a new
 * starting point, and it belongs to today.
 *
 * `epsilon` is 0.05 kg because weights come off a scale to one decimal and a
 * float comparison would re-baseline a plan over 0.00001 kg.
 */
export function planStart(
  currentWeightKg: number,
  existing: PlanStart | null,
  today: string = todayISO()
): PlanStart {
  if (!existing) return { start_weight_kg: currentWeightKg, start_date: today };

  const unchanged = Math.abs(existing.start_weight_kg - currentWeightKg) < 0.05;
  if (unchanged) return existing;

  return { start_weight_kg: currentWeightKg, start_date: today };
}

/**
 * The target date implied by a pace, from a given start.
 *
 * Dated from the plan's *start*, not from today: a plan that begins today and
 * one that began three weeks ago need different end dates for the same pace,
 * and dating both from today quietly stretches an existing plan every time it
 * is saved.
 */
export function targetDateForPace(
  start: PlanStart,
  goalWeightKg: number,
  kgPerWeek: number,
  fallbackDays = 56
): string {
  const toGo = Math.abs(goalWeightKg - start.start_weight_kg);
  if (!kgPerWeek || toGo === 0) return addDays(start.start_date, fallbackDays);

  const weeks = Math.max(1, toGo / Math.abs(kgPerWeek));
  return addDays(start.start_date, Math.round(weeks * 7));
}

/**
 * The pace a chosen target date implies, in kg/week.
 *
 * The inverse of the above, for picking the date and letting the plan follow.
 * Returns null when the date cannot describe a pace — on or before the start,
 * or with nothing to lose or gain.
 */
export function paceForTargetDate(
  start: PlanStart,
  goalWeightKg: number,
  targetDate: string
): number | null {
  const days = daysBetweenIso(start.start_date, targetDate);
  if (days <= 0) return null;

  const change = goalWeightKg - start.start_weight_kg;
  if (change === 0) return 0;

  return Math.round((change / days) * 7 * 100) / 100;
}

/** Whole days between two `YYYY-MM-DD` dates, parsed as UTC on both sides. */
export function daysBetweenIso(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Is this pace something a person should be encouraged to attempt?
 *
 * Losing faster than about 1% of body weight a week costs muscle and rarely
 * holds; gaining faster than ~0.5 kg/week is mostly fat. The editor shows this
 * rather than refusing the date — it is the user's body — but a plan that
 * needs 2 kg a week should say so before it is saved.
 */
export function paceWarning(kgPerWeek: number | null, bodyWeightKg: number): string | null {
  if (kgPerWeek === null || kgPerWeek === 0) return null;

  const perWeek = Math.abs(kgPerWeek);
  if (kgPerWeek < 0) {
    const aggressive = Math.max(0.75, bodyWeightKg * 0.01);
    if (perWeek > aggressive * 1.5) {
      return `That date needs ${perWeek.toFixed(2)} kg a week, which is faster than is usually safe or sustainable. Consider a later date.`;
    }
    if (perWeek > aggressive) {
      return `That is a brisk ${perWeek.toFixed(2)} kg a week. Doable, but expect to lose some muscle with it.`;
    }
    return null;
  }

  if (perWeek > 0.5) {
    return `Gaining ${perWeek.toFixed(2)} kg a week is faster than muscle can be built, so most of it will be fat.`;
  }
  return null;
}
