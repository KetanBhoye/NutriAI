/**
 * Local calendar-date helpers.
 *
 * `Date.toISOString()` converts to UTC first, which is wrong for a food diary:
 * in IST (+5:30) local midnight is 18:30 the previous day in UTC, so
 * `new Date('2026-07-17T00:00:00').toISOString()` yields "2026-07-16". That
 * made day navigation skip two days, and would have logged food to the
 * previous day for anything eaten between midnight and 05:30.
 *
 * A day here is always the user's local calendar day. Ported verbatim from
 * the web app's web/src/dates.ts.
 */

/** Formats a Date as YYYY-MM-DD in local time. */
export function toLocalISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Today, as a local YYYY-MM-DD. */
export function todayISO(): string {
  return toLocalISODate(new Date());
}

/** Parses YYYY-MM-DD as local midnight rather than UTC midnight. */
export function parseISODate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year!, (month ?? 1) - 1, day ?? 1);
}

/** Shifts a YYYY-MM-DD string by whole days, staying in local time. */
export function addDays(value: string, days: number): string {
  const date = parseISODate(value);
  date.setDate(date.getDate() + days);
  return toLocalISODate(date);
}
