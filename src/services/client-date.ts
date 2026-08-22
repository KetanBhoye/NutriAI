/**
 * The calendar day a request is about.
 *
 * Always the *client's* day when it says so, and the server's local day when it
 * doesn't — never UTC. A user at +05:30 is already on tomorrow for the first
 * five and a half hours of UTC's day, so `new Date().toISOString().slice(0, 10)`
 * silently reads the previous day's entries for them. That is what made the
 * meal-suggestion sheet quote a "remaining calories" figure computed from
 * yesterday's food, disagreeing with the Today screen beside it.
 *
 * The day is also a fact the client alone knows: it may be showing a date the
 * user navigated to, which is neither its today nor ours.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function clientDate(supplied: unknown, now: Date = new Date()): string {
  if (typeof supplied === 'string' && ISO_DATE.test(supplied)) return supplied;
  // 'en-CA' formats as YYYY-MM-DD in local time — the shape the DB stores.
  return now.toLocaleDateString('en-CA');
}
