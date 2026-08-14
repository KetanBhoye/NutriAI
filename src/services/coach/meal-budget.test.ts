import { describe, expect, it } from 'vitest';
import { describeBand, mealCalorieBand, pickSuggestions } from './meal-budget.js';

/**
 * The complaint this answers: suggestions were the same handful of plates
 * regardless of how many calories were left. So the tests are mostly about the
 * extremes — a nearly-full day and a nearly-spent one must not look alike.
 */

const band = (remainingCalories: number | null, mealType = 'dinner' as const, remainingProtein = null) =>
  mealCalorieBand({ remainingCalories, remainingProtein, mealType });

describe('mealCalorieBand', () => {
  it('scales the meal to what is actually left', () => {
    const early = band(2000)!;
    const late = band(400)!;

    expect(early.target).toBeGreaterThan(late.target * 2);
    // The whole point: never suggest more than remains in the day.
    expect(late.max).toBeLessThanOrEqual(400);
    expect(early.max).toBeLessThanOrEqual(2000);
  });

  it('gives most of a small remainder to a main meal', () => {
    // 300 kcal left at dinner wants ~all of it, not 35% of it — the share
    // alone would suggest a 105 kcal "dinner".
    const b = band(300)!;

    expect(b.target).toBeGreaterThanOrEqual(200);
    expect(b.max).toBeLessThanOrEqual(300);
  });

  it('sizes a snack well below a main meal on the same budget', () => {
    const snack = mealCalorieBand({ remainingCalories: 1200, remainingProtein: null, mealType: 'snack' })!;
    const dinner = band(1200)!;

    expect(snack.target).toBeLessThan(dinner.target);
    expect(snack.max).toBeLessThan(dinner.min);
  });

  it('flags a day that is already spent instead of inventing headroom', () => {
    // Previously the endpoint floored remaining at 150, so being 400 over
    // looked identical to having 150 left.
    const over = band(-400)!;

    expect(over.overBudget).toBe(true);
    expect(over.max).toBeLessThanOrEqual(120);
  });

  it('flags a tight budget', () => {
    const tight = band(90)!;

    expect(tight.tight).toBe(true);
    expect(tight.overBudget).toBe(false);
    expect(tight.max).toBeLessThanOrEqual(90);
  });

  it('sets no constraint when the user has no calorie goal', () => {
    expect(band(null)).toBeNull();
  });

  it('turns remaining protein into a per-meal target', () => {
    const b = mealCalorieBand({ remainingCalories: 1200, remainingProtein: 80, mealType: 'dinner' })!;

    expect(b.proteinTarget).toBeGreaterThan(0);
    // A share of what's left, not all of it — one meal shouldn't be asked to
    // carry the whole day's shortfall.
    expect(b.proteinTarget!).toBeLessThan(80);
  });
});

describe('describeBand', () => {
  it('states the numbers rather than gesturing at them', () => {
    const text = describeBand(band(1500), 'dinner');

    expect(text).toMatch(/\d+ and \d+ kcal/);
  });

  it('tells the model plainly when the target is already met', () => {
    const text = describeBand(band(-200), 'dinner');

    expect(text).toMatch(/ALREADY MET/);
    expect(text).toMatch(/light/i);
  });
});

describe('pickSuggestions', () => {
  const s = (name: string, calories: number) => ({ name, calories });

  it('prefers options inside the band over closer ones outside it', () => {
    const b = band(1000)!; // dinner: target ~350
    const picked = pickSuggestions([s('huge thali', 900), s('dal & roti', 340), s('poha', 300)], b, 2);

    expect(picked.map((p) => p.name)).toEqual(['dal & roti', 'poha']);
  });

  it('still returns something when nothing fits', () => {
    // The model misjudging calories must not produce an empty sheet — the
    // closest option is a better answer than none.
    const picked = pickSuggestions([s('a', 2000), s('b', 1800)], band(500)!, 3);

    expect(picked).toHaveLength(2);
    expect(picked[0]!.name).toBe('b');
  });

  it('drops duplicate names', () => {
    // Models repeat themselves within one response often enough to waste a slot.
    const picked = pickSuggestions([s('Poha', 300), s('poha ', 310), s('Upma', 320)], band(1000)!, 3);

    expect(picked).toHaveLength(2);
  });

  it('passes everything through when there is no band', () => {
    const picked = pickSuggestions([s('a', 100), s('b', 900)], null, 3);

    expect(picked.map((p) => p.name)).toEqual(['a', 'b']);
  });
});
