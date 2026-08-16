import type { ZodError } from 'zod';

/**
 * Turns a Zod failure into one sentence a person can act on.
 *
 * `ZodError.message` is a JSON dump of every issue — codes, paths, minimums,
 * `inclusive: true`. Routes were passing that straight into
 * `res.json({ error })`, and the app renders `error` verbatim, so submitting
 * the login form with an empty password printed thirty lines of validator
 * internals onto the sign-in screen. It looks broken, and it tells the world
 * more about the schema than it should.
 *
 * Only the first issue is reported. A form that lists every fault at once is
 * a wall of text; the user fixes one thing and resubmits anyway.
 */

/** Field names as a person would say them, where the key isn't already plain. */
const FIELD_LABELS: Record<string, string> = {
  email: 'email address',
  password: 'password',
  name: 'name',
  food_name: 'food name',
  calories: 'calorie amount',
  entry_date: 'date',
  meal_type: 'meal',
  weight_kg: 'weight',
  height_cm: 'height',
  goal_weight_kg: 'goal weight',
  target_date: 'target date',
  activity_date: 'date',
  message: 'message',
};

const label = (path: PropertyKey[]): string => {
  const key = path.filter((p) => typeof p === 'string').join('.');
  if (!key) return 'request';
  return FIELD_LABELS[key] ?? key.replace(/_/g, ' ');
};

export function humanValidationError(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'That request was not valid.';

  const field = label(issue.path as PropertyKey[]);

  switch (issue.code) {
    case 'invalid_string':
      // The common case, and the one people actually hit.
      if ((issue as { validation?: string }).validation === 'email') {
        return 'Enter a valid email address.';
      }
      return `That ${field} is not valid.`;

    case 'too_small': {
      const min = (issue as { minimum?: number | bigint }).minimum;
      const type = (issue as { type?: string }).type;
      if (type === 'string' && Number(min) <= 1) return `Enter your ${field}.`;
      if (type === 'string') return `Your ${field} needs at least ${min} characters.`;
      return `That ${field} is too small.`;
    }

    case 'too_big': {
      const max = (issue as { maximum?: number | bigint }).maximum;
      const type = (issue as { type?: string }).type;
      if (type === 'string') return `That ${field} is too long (max ${max} characters).`;
      return `That ${field} is too large.`;
    }

    case 'invalid_type':
      // `undefined` means it was missing rather than the wrong shape, and
      // "expected string, received undefined" helps nobody.
      return (issue as { received?: string }).received === 'undefined'
        ? `Enter your ${field}.`
        : `That ${field} is not valid.`;

    case 'invalid_enum_value':
      return `That ${field} is not one of the allowed values.`;

    default:
      return `Check the ${field} and try again.`;
  }
}
