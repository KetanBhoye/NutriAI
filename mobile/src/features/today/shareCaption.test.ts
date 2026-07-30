import { describe, expect, it } from 'vitest';
import { formatCardDate, pickCaption } from './shareCaption';
import type { ShareStats } from '@/api/dashboard';

const stats = (over: Partial<ShareStats> = {}): ShareStats => ({
  date: '2026-07-27',
  name: 'Ketan',
  calories: { consumed: 0, goal: 2000 },
  protein: { consumed: 0, goal: 150 },
  carbs_g: 0,
  fat_g: 0,
  steps: null,
  streak: 0,
  weight_kg: null,
  weight_change_kg: null,
  ...over,
});

/**
 * Order matters here: the rarest achievement wins, so the card says something
 * specific rather than settling for the most common headline.
 */
describe('pickCaption', () => {
  it('leads with a week-long streak above everything else', () => {
    const caption = pickCaption(stats({ streak: 9, protein: { consumed: 200, goal: 150 }, steps: 12000 }));
    expect(caption.headline).toContain('9 DAYS');
  });

  it('celebrates hitting protein when the streak is short', () => {
    const caption = pickCaption(stats({ streak: 3, protein: { consumed: 155, goal: 150 } }));
    expect(caption.headline).toContain('PROTEIN');
  });

  it('counts protein exactly on target as hit', () => {
    const caption = pickCaption(stats({ protein: { consumed: 150, goal: 150 } }));
    expect(caption.headline).toContain('PROTEIN');
  });

  it('falls to steps when protein was missed', () => {
    const caption = pickCaption(stats({ protein: { consumed: 100, goal: 150 }, steps: 11500 }));
    expect(caption.headline).toContain('11,500');
  });

  it('needs a real 10k, not almost', () => {
    const caption = pickCaption(
      stats({ protein: { consumed: 100, goal: 150 }, steps: 9800, calories: { consumed: 1800, goal: 2000 } })
    );
    expect(caption.headline).toContain('DIALED');
  });

  it('rewards staying under the calorie goal', () => {
    const caption = pickCaption(stats({ calories: { consumed: 1800, goal: 2000 } }));
    expect(caption.headline).toContain('DIALED');
  });

  it('does not count an empty day as being under target', () => {
    // Logging nothing is not a win, and the card must not imply it was.
    const caption = pickCaption(stats({ calories: { consumed: 0, goal: 2000 } }));
    expect(caption.headline).toContain("TODAY'S");
  });

  it('still says something kind after going over', () => {
    const caption = pickCaption(stats({ calories: { consumed: 2600, goal: 2000 } }));
    expect(caption.headline).toContain('SHOWING UP');
  });

  it('copes with goals that were never set', () => {
    const caption = pickCaption(
      stats({ calories: { consumed: 1500, goal: null }, protein: { consumed: 90, goal: null } })
    );
    expect(caption.headline).toContain('SHOWING UP');
  });

  it('always returns both lines', () => {
    for (const s of [stats(), stats({ streak: 8 }), stats({ calories: { consumed: 9000, goal: 2000 } })]) {
      const caption = pickCaption(s);
      expect(caption.headline.length).toBeGreaterThan(0);
      expect(caption.sub.length).toBeGreaterThan(0);
    }
  });
});

describe('formatCardDate', () => {
  it('renders the web card\'s date treatment', () => {
    expect(formatCardDate('2026-07-27')).toBe('27 JUL 2026');
  });

  it('handles every month', () => {
    expect(formatCardDate('2026-01-01')).toBe('1 JAN 2026');
    expect(formatCardDate('2026-12-31')).toBe('31 DEC 2026');
  });
});
