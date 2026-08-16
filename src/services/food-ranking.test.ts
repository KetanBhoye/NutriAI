import { describe, expect, it } from 'vitest';
import {
  daysBetween,
  rankSuggestions,
  RECENCY_HALF_LIFE_DAYS,
  type LoggedFoodRow,
} from './food-ranking.js';

/**
 * What the "previously added foods" list in the manual-add sheet is ordered by.
 *
 * The rule is not raw frequency: it is frequency weighted by how recently each
 * logging happened, damped so a food logged once cannot outrank a staple. That
 * is easy to get subtly wrong and impossible to notice by eye, because any
 * order looks plausible to someone who has not counted.
 */

const TODAY = '2026-08-17';

const food = (id: string, name: string): Omit<LoggedFoodRow, 'entry_date'> => ({
  id,
  canonical_name: name,
  normalized_key: name.toLowerCase(),
  reference_unit: 'serving',
  calories_per_unit: 100,
  protein_g_per_unit: 5,
  carbs_g_per_unit: 10,
  fat_g_per_unit: 2,
  default_quantity: 1,
  source: 'history',
});

/** n loggings of one food, each `daysAgo` days before TODAY. */
const logged = (
  id: string,
  name: string,
  daysAgoList: number[]
): LoggedFoodRow[] =>
  daysAgoList.map((d) => {
    const date = new Date(Date.parse(`${TODAY}T00:00:00Z`) - d * 86_400_000);
    return { ...food(id, name), entry_date: date.toISOString().slice(0, 10) };
  });

describe('ordering', () => {
  it('puts the most-logged food first', () => {
    const rows = [...logged('a', 'Dal', [1, 2, 3]), ...logged('b', 'Roti', [1])];
    expect(rankSuggestions(rows, TODAY).map((f) => f.canonical_name)).toEqual(['Dal', 'Roti']);
  });

  it('counts how many times each food was logged', () => {
    const rows = [...logged('a', 'Dal', [1, 2, 3]), ...logged('b', 'Roti', [4])];
    const [dal, roti] = rankSuggestions(rows, TODAY);
    expect(dal?.times_logged).toBe(3);
    expect(roti?.times_logged).toBe(1);
  });

  it('reports the most recent logging as last_logged', () => {
    const rows = logged('a', 'Dal', [10, 2, 30]);
    expect(rankSuggestions(rows, TODAY)[0]?.last_logged).toBe('2026-08-15');
  });

  it('prefers a recent habit over an equally frequent abandoned one', () => {
    // Both logged 4 times; one stopped months ago. Raw frequency would tie.
    const rows = [
      ...logged('a', 'Current', [0, 1, 2, 3]),
      ...logged('b', 'Abandoned', [120, 121, 122, 123]),
    ];
    expect(rankSuggestions(rows, TODAY).map((f) => f.canonical_name)).toEqual([
      'Current',
      'Abandoned',
    ]);
  });

  it('does not let a single recent logging beat an established staple', () => {
    // The whole point of the frequency prior. Without it, "logged once
    // yesterday" would score ~1.0 and top the list every time.
    const rows = [
      ...logged('a', 'Staple', [1, 3, 5, 7, 9, 11]),
      ...logged('b', 'Tried once', [0]),
    ];
    expect(rankSuggestions(rows, TODAY)[0]?.canonical_name).toBe('Staple');
  });

  it('breaks ties by name so the order is stable, not insertion-dependent', () => {
    const rows = [...logged('b', 'Zucchini', [2]), ...logged('a', 'Apple', [2])];
    expect(rankSuggestions(rows, TODAY).map((f) => f.canonical_name)).toEqual([
      'Apple',
      'Zucchini',
    ]);
  });
});

describe('the recency half-life', () => {
  it('halves a logging\'s weight after exactly one half-life', () => {
    const today = rankSuggestions(logged('a', 'X', [0]), TODAY)[0]!;
    const old = rankSuggestions(logged('a', 'X', [RECENCY_HALF_LIFE_DAYS]), TODAY)[0]!;
    expect(old.score / today.score).toBeCloseTo(0.5, 2);
  });

  it('keeps an old staple on the list rather than dropping it to zero', () => {
    // Fading, not disappearing — someone who ate rice daily last year should
    // still find it in the list.
    const score = rankSuggestions(logged('a', 'Rice', [90]), TODAY)[0]?.score ?? 0;
    expect(score).toBeGreaterThan(0);
  });
});

describe('limit', () => {
  it('returns at most the requested number', () => {
    const rows = Array.from({ length: 20 }, (_, i) => logged(`f${i}`, `Food ${i}`, [i + 1])).flat();
    expect(rankSuggestions(rows, TODAY, 8)).toHaveLength(8);
  });

  it('keeps the highest scorers when it truncates', () => {
    const rows = [
      ...logged('top', 'Top', [0, 0, 0, 1, 1]),
      ...logged('mid', 'Mid', [5, 6]),
      ...logged('low', 'Low', [200]),
    ];
    expect(rankSuggestions(rows, TODAY, 2).map((f) => f.canonical_name)).toEqual(['Top', 'Mid']);
  });
});

describe('edge cases', () => {
  it('returns nothing for a user who has logged nothing', () => {
    expect(rankSuggestions([], TODAY)).toEqual([]);
  });

  it('does not let a future-dated entry outrank everything', () => {
    // A timezone edge or a user logging tomorrow's dinner would otherwise get
    // a weight above 1.0.
    const future = rankSuggestions(logged('a', 'Future', [-5]), TODAY)[0]!;
    const today = rankSuggestions(logged('b', 'Today', [0]), TODAY)[0]!;
    expect(future.score).toBeLessThanOrEqual(today.score);
  });

  it('carries the food fields through untouched', () => {
    const [only] = rankSuggestions(logged('a', 'Dal', [1]), TODAY);
    expect(only).toMatchObject({
      id: 'a',
      canonical_name: 'Dal',
      calories_per_unit: 100,
      protein_g_per_unit: 5,
      reference_unit: 'serving',
    });
    // entry_date is an implementation detail of the query, not part of the API.
    expect(only).not.toHaveProperty('entry_date');
  });
});

describe('daysBetween', () => {
  it('counts whole days', () => {
    expect(daysBetween('2026-08-10', '2026-08-17')).toBe(7);
  });

  it('is timezone-proof', () => {
    // Parsed as UTC on both sides; a developer in +05:30 must get the same
    // answer as production in UTC.
    expect(daysBetween('2026-08-16', '2026-08-17')).toBe(1);
    expect(daysBetween('2026-08-17', '2026-08-17')).toBe(0);
  });

  it('crosses a month boundary', () => {
    expect(daysBetween('2026-07-31', '2026-08-01')).toBe(1);
  });

  it('returns 0 for unparseable input rather than NaN', () => {
    // NaN would propagate into every score and sort unpredictably.
    expect(daysBetween('not-a-date', '2026-08-17')).toBe(0);
  });
});
