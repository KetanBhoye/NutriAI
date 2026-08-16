import type { FoodRow, SuggestedFood } from '../repositories/food-library.repository.js';

/**
 * Ranks a meal slot's foods by recency-weighted frequency.
 *
 * This used to be one SQL expression built on `julianday()`, which is a SQLite
 * function with no Postgres equivalent — the suggestions endpoint returned a
 * 500 on Postgres and nothing else did, because it is the only query that does
 * date arithmetic in the database rather than in the app.
 *
 * Doing it here instead makes it dialect-free, and it can be tested against
 * fixed dates without a database at all, which the SQL version never could.
 */

/**
 * Half-life in days for the recency weighting. A food eaten today counts 1.0,
 * three weeks ago 0.5, three months ago ~0.05 — so habits that changed
 * recently surface quickly while older staples fade without disappearing.
 */
export const RECENCY_HALF_LIFE_DAYS = 21;

/**
 * Foods logged only once shouldn't outrank a staple just because they were
 * eaten yesterday. This damps a food's score until it has been logged a few
 * times: n=1 keeps ~50% of its weight, n=3 ~75%, n=10 ~91%.
 */
export const FREQUENCY_PRIOR = 1;

/** ln(2), the decay constant that turns a half-life into an exponent. */
const LN2 = 0.693147;

/** One row per logged entry, joined to the food it refers to. */
export interface LoggedFoodRow extends FoodRow {
  entry_date: string;
}

const MS_PER_DAY = 86_400_000;

/**
 * Whole days between two `YYYY-MM-DD` dates. Parsed as UTC on both sides so a
 * developer's timezone cannot shift an age by a day — the same reason
 * db/time.ts renders everything in UTC.
 */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / MS_PER_DAY);
}

export function rankSuggestions(
  rows: LoggedFoodRow[],
  today: string,
  limit = 8
): SuggestedFood[] {
  const byFood = new Map<string, { food: LoggedFoodRow; dates: string[] }>();

  for (const row of rows) {
    const existing = byFood.get(row.id);
    if (existing) existing.dates.push(row.entry_date);
    else byFood.set(row.id, { food: row, dates: [row.entry_date] });
  }

  const scored: SuggestedFood[] = [];
  for (const { food, dates } of byFood.values()) {
    const timesLogged = dates.length;

    // Sum of exp(-ln2 * age / halfLife): every logging contributes, weighted
    // by how long ago it was.
    let weighted = 0;
    for (const date of dates) {
      // A future-dated entry (timezone edge, or a user logging ahead) would
      // otherwise score above 1.0 and outrank everything.
      const age = Math.max(0, daysBetween(date, today));
      weighted += Math.exp((-LN2 * age) / RECENCY_HALF_LIFE_DAYS);
    }

    const confidence = timesLogged / (timesLogged + FREQUENCY_PRIOR);

    const { entry_date: _ignored, ...foodFields } = food;
    scored.push({
      ...foodFields,
      times_logged: timesLogged,
      last_logged: dates.reduce((a, b) => (a > b ? a : b)),
      score: weighted * confidence,
    });
  }

  // Name is the tiebreaker so the order is stable rather than dependent on the
  // order rows happened to come back in.
  scored.sort((a, b) => b.score - a.score || a.canonical_name.localeCompare(b.canonical_name));
  return scored.slice(0, limit);
}
