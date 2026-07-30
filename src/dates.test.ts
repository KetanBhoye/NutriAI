import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDays, parseISODate, toLocalISODate, todayISO } from './dates';

/**
 * These all guard one bug: `Date.toISOString()` converts to UTC first, so in
 * any timezone ahead of it, local midnight is the *previous* day in UTC. That
 * made day navigation skip two days and would have filed anything eaten after
 * midnight under yesterday.
 */

afterEach(() => {
  vi.useRealTimers();
});

describe('toLocalISODate', () => {
  it('formats the local calendar day, not the UTC one', () => {
    // Local midnight — in IST this instant is 18:30 the day before in UTC.
    const midnight = new Date(2026, 6, 17, 0, 0, 0);
    expect(toLocalISODate(midnight)).toBe('2026-07-17');
  });

  it('still reports the local day late at night', () => {
    const lateEvening = new Date(2026, 6, 17, 23, 45, 0);
    expect(toLocalISODate(lateEvening)).toBe('2026-07-17');
  });

  it('zero-pads months and days', () => {
    expect(toLocalISODate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('todayISO', () => {
  it('follows the device clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 17, 2, 15));
    expect(todayISO()).toBe('2026-07-17');
  });

  it('rolls over at local midnight, not at UTC midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 17, 23, 59, 59));
    expect(todayISO()).toBe('2026-07-17');
    vi.setSystemTime(new Date(2026, 6, 18, 0, 0, 1));
    expect(todayISO()).toBe('2026-07-18');
  });
});

describe('parseISODate', () => {
  it('parses to local midnight', () => {
    const d = parseISODate('2026-07-17');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6);
    expect(d.getDate()).toBe(17);
    // UTC parsing would leave this at some other hour in most timezones.
    expect(d.getHours()).toBe(0);
  });

  it('round-trips with toLocalISODate', () => {
    for (const iso of ['2026-01-01', '2026-02-28', '2026-12-31']) {
      expect(toLocalISODate(parseISODate(iso))).toBe(iso);
    }
  });
});

describe('addDays', () => {
  it('shifts forwards and backwards', () => {
    expect(addDays('2026-07-17', 1)).toBe('2026-07-18');
    expect(addDays('2026-07-17', -1)).toBe('2026-07-16');
    expect(addDays('2026-07-17', 0)).toBe('2026-07-17');
  });

  it('crosses month and year boundaries', () => {
    expect(addDays('2026-07-31', 1)).toBe('2026-08-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('handles February in a leap year', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('spans the eight-week plan window used by the editor', () => {
    expect(addDays('2026-07-17', 56)).toBe('2026-09-11');
  });
});
