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
  it('leads with everything-at-once above any single win', () => {
    const caption = pickCaption(
      stats({
        streak: 9,
        protein: { consumed: 200, goal: 150 },
        calories: { consumed: 1800, goal: 2000 },
        steps: 12000,
      })
    );

    expect(caption.theme).toBe('perfect');
  });

  it('never makes a week-scale claim on a card about one day', () => {
    // Streak tiers used to outrank every day achievement, so a good day led
    // with "A WEEK STRONG / Every day logged" — a week statement on a day
    // card, competing with the weekly card for the same story. The day's own
    // wins now lead, and the streak is the weekly card's to tell.
    const caption = pickCaption(
      stats({ streak: 31, protein: { consumed: 200, goal: 150 }, steps: 12000 })
    );

    expect(caption.theme).not.toBe('streak');
    expect(`${caption.headline} ${caption.sub}`).not.toMatch(/\b31\b|streak|week/i);
  });

  it('leads with what the day itself earned', () => {
    const caption = pickCaption(
      stats({
        streak: 31,
        calories: { consumed: 1900, goal: 2000 },
        protein: { consumed: 200, goal: 150 },
        steps: 12000,
      })
    );
    // Protein + under calories + 10k steps is a clean sweep, and that is a
    // fact about today.
    expect(caption.theme).toBe('perfect');
  });

  it('celebrates hitting protein when the streak is short', () => {
    const caption = pickCaption(stats({ streak: 3, protein: { consumed: 155, goal: 150 } }));
    expect(caption.theme).toBe('protein');
  });

  it('does not lead with the weight trend either', () => {
    // Same reasoning as the streak: a multi-week trend is not something a
    // single day earned, and Plan already tells that story properly.
    const caption = pickCaption(
      stats({ weight_change_kg: -0.8, protein: { consumed: 200, goal: 150 } })
    );

    expect(caption.theme).toBe('protein');
    expect(`${caption.headline} ${caption.sub}`).not.toContain('0.8');
  });

  it('ignores weight moving the wrong way', () => {
    const caption = pickCaption(stats({ weight_change_kg: 0.6, calories: { consumed: 1500, goal: 2000 } }));
    expect(caption.theme).not.toBe('weight');
  });

  it('separates a huge step day from a merely good one', () => {
    expect(pickCaption(stats({ steps: 16000 })).headline).toMatch(/16,000|LEGS/);
    expect(pickCaption(stats({ steps: 10500 })).theme).toBe('steps');
  });

  it('falls back to showing up, then to an empty day', () => {
    expect(pickCaption(stats({ calories: { consumed: 900, goal: null } })).theme).toBe('default');
    expect(pickCaption(stats()).sub.length).toBeGreaterThan(0);
  });

  it('never returns an empty headline or sub', () => {
    const cases: Array<Partial<ShareStats>> = [
      {},
      { streak: 7 },
      { streak: 40 },
      { steps: 20000 },
      { weight_change_kg: -1.2 },
      { protein: { consumed: 160, goal: 150 } },
      { calories: { consumed: 1200, goal: 2000 } },
    ];

    for (const over of cases) {
      const c = pickCaption(stats(over));
      expect(c.headline.trim().length).toBeGreaterThan(0);
      expect(c.sub.trim().length).toBeGreaterThan(0);
      expect(c.theme).toBeTruthy();
    }
  });
});

describe('caption variety', () => {
  it('is stable within a day, so the preview matches what gets shared', () => {
    const s = stats({ streak: 8 });

    expect(pickCaption(s)).toEqual(pickCaption(s));
  });

  it('varies across days, so a week of cards does not read identically', () => {
    // The point of the feature: a card that says the same thing every day is a
    // card people post once.
    const seen = new Set<string>();
    for (const date of ['2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25', '2026-07-26']) {
      seen.add(pickCaption(stats({ date, calories: { consumed: 1500, goal: 2000 } })).headline);
    }

    expect(seen.size).toBeGreaterThan(1);
  });

  it('keeps the theme fixed even as the wording rotates', () => {
    // Theme tracks the achievement, not the sentence — otherwise the card's
    // colour would flicker day to day for the same kind of day.
    for (const date of ['2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24']) {
      expect(pickCaption(stats({ date, calories: { consumed: 1500, goal: 2000 } })).theme).toBe('dialed');
    }
  });
});

describe('formatCardDate', () => {
  it('renders a short uppercase date', () => {
    expect(formatCardDate('2026-07-27')).toBe('27 JUL 2026');
  });
});
