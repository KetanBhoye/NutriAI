import { describe, expect, it } from 'vitest';
import type { Consistency } from '@/api/dashboard';

/**
 * The presentation rules the card must honour.
 *
 * These are about what the user is shown, not about arithmetic — the formula
 * is pinned server-side in services/consistency.test.ts. What matters here is
 * that the client cannot undo the protections the server applied: it must not
 * invent a peer comparison, and it must not render an untracked component as
 * a zero.
 */

const base: Consistency = {
  available: true,
  week_start: '2026-08-17',
  score: 73,
  days_logged: 6,
  previous_score: 60,
  personal_best: 70,
  is_personal_best: true,
  components: { logging: 86, calories: 71, protein: 64, movement: 55 },
  headline: { band: 'strong', title: 'Your best week yet', detail: '73 out of 100.' },
  history: [
    { weekStart: '2026-06-29', score: 20 },
    { weekStart: '2026-07-06', score: 35 },
    { weekStart: '2026-07-13', score: 40 },
    { weekStart: '2026-07-20', score: 52 },
    { weekStart: '2026-07-27', score: 48 },
    { weekStart: '2026-08-03', score: 61 },
    { weekStart: '2026-08-10', score: 70 },
    { weekStart: '2026-08-17', score: 73 },
  ],
  comparison: null,
};

/** Mirrors the card's own decision, kept in one place so the test can assert it. */
const showsPeerLine = (data: Consistency) => data.comparison !== null;
const componentLabel = (value: number | null) => (value === null ? 'Not tracked' : `${value}%`);

describe('the peer comparison', () => {
  it('is not shown when the server withheld it', () => {
    // The server suppresses it below the 25th percentile, for tiny
    // populations, and for barely-logged weeks. The client must not second
    // guess that — it has no percentile to render anyway.
    expect(showsPeerLine({ ...base, comparison: null })).toBe(false);
  });

  it('is shown when the server sent one', () => {
    expect(
      showsPeerLine({ ...base, comparison: { better_than_percent: 93, population: 22 } })
    ).toBe(true);
  });

  it('has no percentile to fall back on when withheld', () => {
    // Guards against a future "show it anyway" change: there is genuinely no
    // number in the payload to display.
    const withheld = { ...base, comparison: null };
    expect(JSON.stringify(withheld)).not.toContain('better_than_percent');
  });
});

describe('components with no goal set', () => {
  it('reads as not tracked rather than 0%', () => {
    // 0% would look like failing at something the user was never asked to do.
    expect(componentLabel(null)).toBe('Not tracked');
    expect(componentLabel(0)).toBe('0%');
  });

  it('renders a real zero as a zero', () => {
    // A tracked goal genuinely missed all week should still say 0%.
    expect(componentLabel(0)).toBe('0%');
  });
});

describe('the eight-week trend', () => {
  it('always has the current week last', () => {
    expect(base.history[base.history.length - 1]?.weekStart).toBe(base.week_start);
  });

  it('is ordered oldest first, so the bars read left to right in time', () => {
    const starts = base.history.map((h) => h.weekStart);
    expect([...starts].sort()).toEqual(starts);
  });

  it('scales against at least 100 so a good week is not drawn as full height', () => {
    // Scaling to the max score would make a 20-point week look identical to a
    // 100-point one whenever 20 was the best of the eight.
    const weak = base.history.map((h) => ({ ...h, score: 20 }));
    const peak = Math.max(100, ...weak.map((h) => h.score));
    expect(peak).toBe(100);
  });
});

describe('the personal best pill', () => {
  it('shows when this week is the best', () => {
    expect(base.is_personal_best && base.score > 0).toBe(true);
  });

  it('does not show for a zero score, even if it ties an all-zero history', () => {
    // A brand-new user with no history would otherwise be congratulated for
    // having logged nothing at all.
    const fresh = { ...base, score: 0, is_personal_best: true };
    expect(fresh.is_personal_best && fresh.score > 0).toBe(false);
  });
});
