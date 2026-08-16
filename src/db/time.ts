/**
 * Timestamp comparison that means the same thing in SQLite and Postgres.
 *
 * Expiry checks used to read `datetime(expires_at) > datetime('now')`, which is
 * a SQLite function and does not exist in Postgres. `datetime()` was doing real
 * work, though: this database stores timestamps in **two** formats.
 *
 *   expires_at  →  2026-08-21T08:28:05.617Z   (Date.toISOString(), UTC)
 *   created_at  →  2026-03-10 11:15:55        (CURRENT_TIMESTAMP default, UTC)
 *
 * SQLite's `datetime()` parses both and normalises them, so the mismatch never
 * showed. A naive port to plain string comparison does not, and the failure is
 * silent: 'T' (0x54) sorts after ' ' (0x20), so once the YYYY-MM-DD prefix
 * matches, an ISO-formatted `expires_at` looks greater than a space-formatted
 * "now" and the row reads as unexpired.
 *
 * The window is same-day only — a differing date is decided by the digits
 * first — which is exactly what makes it dangerous. Sessions, tokens and auth
 * codes all have hour-scale TTLs, so same-day is when expiry does its work,
 * while anything expiring yesterday still behaves correctly and hides the bug.
 *
 * So comparisons bind an explicit value in the same format as the column, and
 * the two formats get separate helpers rather than one that guesses.
 */

/** Matches `expires_at`: `Date.toISOString()`, e.g. 2026-08-21T08:28:05.617Z. */
export function isoNow(now: Date = new Date()): string {
  return now.toISOString();
}

/** Matches columns defaulted from CURRENT_TIMESTAMP: `YYYY-MM-DD HH:MM:SS` UTC. */
export function sqlTimestampNow(now: Date = new Date()): string {
  return now.toISOString().slice(0, 19).replace('T', ' ');
}

/** Matches `entry_date` / `activity_date` / `recorded_date`: `YYYY-MM-DD` UTC. */
export function utcDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * The window boundary for "the last N days", as `YYYY-MM-DD`.
 *
 * Replaces SQLite's `date('now', '-6 days')`, which Postgres has no equivalent
 * for. Computing it here and binding it as a parameter is dialect-free, and it
 * makes the window testable without a database.
 *
 * `daysAgo(6)` is the start of a **7**-day inclusive window (today plus the six
 * before it), matching what the SQL it replaces meant.
 */
export function daysAgo(days: number, now: Date = new Date()): string {
  const then = new Date(now.getTime());
  then.setUTCDate(then.getUTCDate() - days);
  return utcDate(then);
}
