import { describe, expect, it } from 'vitest';
import { isoNow, sqlTimestampNow } from './time.js';

const AT = new Date('2026-08-17T01:34:27.123Z');

describe('the two stored formats', () => {
  it('isoNow matches what expires_at columns hold', () => {
    // Ground truth from the production backup: 2026-08-21T08:28:05.617Z
    expect(isoNow(AT)).toBe('2026-08-17T01:34:27.123Z');
  });

  it('sqlTimestampNow matches what CURRENT_TIMESTAMP columns hold', () => {
    // Ground truth from the production backup: 2026-03-10 11:15:55
    expect(sqlTimestampNow(AT)).toBe('2026-08-17 01:34:27');
  });

  it('renders UTC regardless of the machine timezone', () => {
    // Production runs UTC; developers do not. A local-time rendering would
    // expire sessions 5.5 hours early or late for an IST machine.
    expect(sqlTimestampNow(AT).startsWith('2026-08-17 01:')).toBe(true);
  });
});

describe('why the formats must not be mixed', () => {
  it('would treat a session that expired earlier today as still live', () => {
    // The bug the helpers exist to prevent, asserted directly.
    //
    // 'T' (0x54) sorts after ' ' (0x20). Once the YYYY-MM-DD prefix matches,
    // that byte decides the comparison, so an ISO expires_at always looks
    // greater than a space-formatted "now" on the same day.
    //
    // The window is same-day only — a differing year or month is decided by
    // the digits first — but session TTLs are measured in hours, so same-day
    // is precisely when expiry matters.
    const expiredAt0000 = '2026-08-17T00:00:00.000Z'; // 1h34m before AT
    const nowWrongFormat = sqlTimestampNow(AT); // '2026-08-17 01:34:27'
    expect(expiredAt0000 > nowWrongFormat).toBe(true); // the silent bug

    const nowRightFormat = isoNow(AT);
    expect(expiredAt0000 > nowRightFormat).toBe(false); // correctly expired
  });

  it('still expires correctly across a date boundary, which is why it hid', () => {
    // Yesterday's session compares correctly even with mismatched formats,
    // so casual testing would never reveal the problem.
    expect('2026-08-16T23:59:59.000Z' > sqlTimestampNow(AT)).toBe(false);
  });

  it('orders same-format ISO strings chronologically', () => {
    // Lexicographic ordering of fixed-width ISO-8601 UTC equals chronological
    // ordering, which is what makes the plain `>` comparison correct.
    const stamps = [
      '2026-08-17T01:34:27.123Z',
      '2026-08-17T01:34:27.124Z',
      '2026-08-17T01:35:00.000Z',
      '2026-09-01T00:00:00.000Z',
      '2027-01-01T00:00:00.000Z',
    ];
    expect([...stamps].sort()).toEqual(stamps);
  });

  it('orders same-format SQL timestamps chronologically', () => {
    const stamps = ['2026-03-10 11:15:55', '2026-07-24 23:52:58', '2026-08-17 01:34:27'];
    expect([...stamps].sort()).toEqual(stamps);
  });
});
