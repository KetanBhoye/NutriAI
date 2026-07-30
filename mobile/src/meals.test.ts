import { afterEach, describe, expect, it, vi } from 'vitest';
import { MEALS, currentMeal, groupByMeal, remainingCalories, sumTotals } from './meals';
import { FoodEntry, MealType } from './types';

const entry = (over: Partial<FoodEntry> = {}): FoodEntry => ({
  id: 'e1',
  user_id: 'u1',
  food_name: 'Dal',
  calories: 300,
  protein_g: 18,
  carbs_g: 40,
  fat_g: 8,
  meal_type: 'lunch',
  entry_date: '2026-07-17',
  food_id: null,
  quantity: 200,
  unit: 'g',
  created_at: '',
  updated_at: '',
  ...over,
});

afterEach(() => {
  vi.useRealTimers();
});

describe('currentMeal', () => {
  const at = (hour: number) => currentMeal(new Date(2026, 6, 17, hour, 0));

  it('maps the clock to the obvious meal', () => {
    expect(at(7)).toBe('breakfast');
    expect(at(13)).toBe('lunch');
    expect(at(19)).toBe('dinner');
    expect(at(22)).toBe('snack');
  });

  it('treats a late-night meal as a snack, not tomorrow\'s breakfast', () => {
    expect(at(23)).toBe('snack');
  });

  it('counts the small hours as breakfast', () => {
    // 1am is the previous day's snack in spirit, but the day has already
    // rolled over — breakfast is the least wrong bucket.
    expect(at(1)).toBe('breakfast');
  });

  it('switches exactly on the boundaries', () => {
    expect(at(10)).toBe('breakfast');
    expect(at(11)).toBe('lunch');
    expect(at(15)).toBe('lunch');
    expect(at(16)).toBe('dinner');
    expect(at(20)).toBe('dinner');
    expect(at(21)).toBe('snack');
  });

  it('reads the device clock when not given one', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 17, 12, 30));
    expect(currentMeal()).toBe('lunch');
  });
});

describe('sumTotals', () => {
  it('is zero for an empty day', () => {
    expect(sumTotals([])).toEqual({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
  });

  it('adds every entry up', () => {
    const totals = sumTotals([entry(), entry({ id: 'e2', calories: 150, protein_g: 5, carbs_g: 20, fat_g: 3 })]);
    expect(totals).toEqual({ calories: 450, protein_g: 23, carbs_g: 60, fat_g: 11 });
  });

  it('treats an unknown macro as zero, not as missing data', () => {
    // A food logged with only calories must not turn the day's protein into NaN.
    const totals = sumTotals([entry({ protein_g: null, carbs_g: null, fat_g: null })]);
    expect(totals).toEqual({ calories: 300, protein_g: 0, carbs_g: 0, fat_g: 0 });
  });

  it('counts entries whose meal is unset — they still fed you', () => {
    expect(sumTotals([entry({ meal_type: null })]).calories).toBe(300);
  });
});

describe('groupByMeal', () => {
  it('always returns all four meals, even when empty', () => {
    const grouped = groupByMeal([]);
    expect(Object.keys(grouped).sort()).toEqual([...MEALS].sort());
    for (const meal of MEALS) expect(grouped[meal]).toEqual([]);
  });

  it('files each entry under its meal', () => {
    const grouped = groupByMeal([
      entry({ id: 'a', meal_type: 'breakfast' }),
      entry({ id: 'b', meal_type: 'dinner' }),
      entry({ id: 'c', meal_type: 'dinner' }),
    ]);

    expect(grouped.breakfast.map((e) => e.id)).toEqual(['a']);
    expect(grouped.dinner.map((e) => e.id)).toEqual(['b', 'c']);
    expect(grouped.lunch).toEqual([]);
  });

  it('preserves order within a meal', () => {
    const grouped = groupByMeal([entry({ id: 'first' }), entry({ id: 'second' })]);
    expect(grouped.lunch.map((e) => e.id)).toEqual(['first', 'second']);
  });

  it('leaves an entry with no meal out rather than guessing', () => {
    // Dumping it into "snack" would silently move someone's dinner.
    const grouped = groupByMeal([entry({ meal_type: null })]);
    for (const meal of MEALS) expect(grouped[meal]).toEqual([]);
  });

  it('handles every meal type the API can return', () => {
    const all = MEALS.map((m: MealType, i) => entry({ id: `e${i}`, meal_type: m }));
    const grouped = groupByMeal(all);
    for (const meal of MEALS) expect(grouped[meal]).toHaveLength(1);
  });
});

describe('remainingCalories', () => {
  it('counts down from the goal', () => {
    expect(remainingCalories(2000, 750)).toBe(1250);
  });

  it('reads zero when you go over, never a negative', () => {
    // "-320 left" is both ugly and discouraging; the ring just empties.
    expect(remainingCalories(2000, 2320)).toBe(0);
  });

  it('is the whole goal before anything is logged', () => {
    expect(remainingCalories(2000, 0)).toBe(2000);
  });
});
