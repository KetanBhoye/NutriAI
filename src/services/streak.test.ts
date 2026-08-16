import { describe, expect, it } from 'vitest';
import { COMPLETE_DAY_KCAL, loggingStreak } from './streak.js';

const day = (entry_date: string, calories = 2000) => ({ entry_date, calories });

describe('loggingStreak', () => {
  it('counts consecutive days back from today', () => {
    const daily = [day('2026-08-17'), day('2026-08-16'), day('2026-08-15')];
    expect(loggingStreak(daily, '2026-08-17')).toBe(3);
  });

  it('does not break the streak just because today is still in progress', () => {
    // Opening the app at 9am before eating must not show a streak of zero.
    const daily = [day('2026-08-16'), day('2026-08-15')];
    expect(loggingStreak(daily, '2026-08-17')).toBe(2);
  });

  it('stops at the first missing day', () => {
    const daily = [day('2026-08-17'), day('2026-08-16'), day('2026-08-14')];
    expect(loggingStreak(daily, '2026-08-17')).toBe(2);
  });

  it('ignores a day too thin to be a real record', () => {
    // A single 240 kcal entry is an abandoned log, not a day of tracking.
    const daily = [day('2026-08-17'), day('2026-08-16', 240), day('2026-08-15')];
    expect(loggingStreak(daily, '2026-08-17')).toBe(1);
  });

  it('counts a day exactly on the threshold', () => {
    expect(loggingStreak([day('2026-08-17', COMPLETE_DAY_KCAL)], '2026-08-17')).toBe(1);
  });

  it('is zero when nothing has been logged', () => {
    expect(loggingStreak([], '2026-08-17')).toBe(0);
  });

  it('crosses a month boundary', () => {
    const daily = [day('2026-09-01'), day('2026-08-31'), day('2026-08-30')];
    expect(loggingStreak(daily, '2026-09-01')).toBe(3);
  });

  it('crosses a year boundary', () => {
    const daily = [day('2027-01-01'), day('2026-12-31'), day('2026-12-30')];
    expect(loggingStreak(daily, '2027-01-01')).toBe(3);
  });

  it('handles a leap day', () => {
    const daily = [day('2028-03-01'), day('2028-02-29'), day('2028-02-28')];
    expect(loggingStreak(daily, '2028-03-01')).toBe(3);
  });

  it('works in the timezone that used to break it', () => {
    /**
     * The bug: the walk used `toISOString()`, which is UTC. For a user at
     * +05:30 the first five and a half hours of every local day are still
     * "yesterday" in UTC, so the streak read one short each morning and then
     * silently repaired itself later in the day.
     *
     * Passing the client's own local day and doing string arithmetic removes
     * the timezone from the question entirely — this test asserts the result
     * depends only on the dates given.
     */
    const daily = [day('2026-08-17'), day('2026-08-16'), day('2026-08-15')];
    const original = process.env.TZ;
    try {
      process.env.TZ = 'Asia/Kolkata';
      expect(loggingStreak(daily, '2026-08-17')).toBe(3);
      process.env.TZ = 'Pacific/Auckland';
      expect(loggingStreak(daily, '2026-08-17')).toBe(3);
      process.env.TZ = 'America/Los_Angeles';
      expect(loggingStreak(daily, '2026-08-17')).toBe(3);
    } finally {
      process.env.TZ = original;
    }
  });
});
