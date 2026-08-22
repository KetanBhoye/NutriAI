import { describe, expect, it } from 'vitest';
import { clientDate } from './client-date.js';

describe('clientDate', () => {
  it('uses the day the client asked about', () => {
    expect(clientDate('2026-08-20')).toBe('2026-08-20');
  });

  it('falls back to the local day rather than the UTC one', () => {
    // 20:00 UTC on the 22nd is already the 23rd anywhere east of +04:00. The
    // old `toISOString()` call returned the 22nd there, reading a whole day of
    // entries the user had not eaten today.
    const evening = new Date('2026-08-22T20:00:00Z');

    expect(clientDate(undefined, evening)).toBe(evening.toLocaleDateString('en-CA'));
  });

  it('ignores anything that is not a plain YYYY-MM-DD date', () => {
    const now = new Date('2026-08-23T12:00:00Z');
    const today = now.toLocaleDateString('en-CA');

    for (const bad of [null, 42, {}, [], '', 'today', '2026-8-3', '2026-08-23T00:00:00Z']) {
      expect(clientDate(bad, now)).toBe(today);
    }
  });
});
