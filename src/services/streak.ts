/**
 * The logging streak: consecutive days with a real day's food recorded.
 *
 * Extracted from the share endpoint so the app can show it, and fixed on the
 * way out. The original walked days with `toISOString().split('T')[0]`, which
 * is **UTC** — for a user at +05:30 that is yesterday's date for the first five
 * and a half hours of every day, so a streak could read one short each morning
 * and then repair itself by lunchtime. Entry dates are stored as local
 * calendar days, so the walk has to be done in those terms too.
 *
 * Two judgements worth keeping:
 *
 *  - A day counts only if enough was logged to be a genuine record. The
 *    history is full of days with a single 240 kcal entry; those are abandoned
 *    logs, not fasts, and counting them flatters the streak into meaninglessness.
 *  - **Today does not break the streak until it is over.** Opening the app at
 *    9am to a streak reset to zero, because you have not eaten yet, would be
 *    both wrong and demoralising.
 */

/** Below this, a day reads as an abandoned log rather than a record. */
export const COMPLETE_DAY_KCAL = 1200;

export interface DayTotal {
  entry_date: string;
  calories: number;
}

/** `2026-08-17` → `2026-08-16`. String in, string out — no timezone anywhere. */
function previousDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  // UTC arithmetic on a date with no time component cannot drift: the input
  // and output are both plain calendar days.
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * @param today The user's local calendar day, as the client sees it.
 */
export function loggingStreak(daily: DayTotal[], today: string): number {
  const logged = new Set(
    daily.filter((d) => d.calories >= COMPLETE_DAY_KCAL).map((d) => d.entry_date)
  );

  // Start at today if it already counts, otherwise at yesterday — a day in
  // progress is not yet a broken one.
  let cursor = logged.has(today) ? today : previousDay(today);

  let streak = 0;
  while (logged.has(cursor)) {
    streak += 1;
    cursor = previousDay(cursor);
  }

  return streak;
}
