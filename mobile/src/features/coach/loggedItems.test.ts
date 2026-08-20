import { describe, expect, it } from 'vitest';
import { FoodEntry } from '@/types';
import { additionsOnly, diffEntries, diffHeadline } from './loggedItems';

function entry(over: Partial<FoodEntry> & { id: string }): FoodEntry {
  return {
    user_id: 'u1',
    food_name: 'Chapati (2)',
    calories: 200,
    protein_g: 6,
    carbs_g: 40,
    fat_g: 2,
    meal_type: 'lunch',
    entry_date: '2026-08-20',
    food_id: null,
    quantity: 100,
    unit: 'g',
    created_at: '',
    updated_at: '',
    ...over,
  };
}

describe('diffEntries', () => {
  it('reports nothing for a turn that only read the day', () => {
    const day = [entry({ id: 'a' }), entry({ id: 'b' })];
    expect(diffEntries(day, day)).toBeNull();
  });

  it('lists new entries and the calories they added', () => {
    const diff = diffEntries([entry({ id: 'a' })], [entry({ id: 'a' }), entry({ id: 'b', calories: 320 })]);
    expect(diff?.added.map((i) => i.id)).toEqual(['b']);
    expect(diff?.updated).toEqual([]);
    expect(diff?.delta.calories).toBe(320);
    expect(diff?.dayTotals.calories).toBe(520);
  });

  it('separates an edit from a new row', () => {
    const diff = diffEntries(
      [entry({ id: 'a', calories: 200 })],
      [entry({ id: 'a', calories: 260, food_name: 'Chapati (3)' })]
    );
    expect(diff?.added).toEqual([]);
    expect(diff?.updated.map((i) => i.name)).toEqual(['Chapati (3)']);
    expect(diff?.delta.calories).toBe(60);
  });

  it('counts a deletion as a negative change', () => {
    const diff = diffEntries([entry({ id: 'a' }), entry({ id: 'b', calories: 90 })], [entry({ id: 'a' })]);
    expect(diff?.removed.map((i) => i.id)).toEqual(['b']);
    expect(diff?.delta.calories).toBe(-90);
  });

  it('ignores a row whose only change is a timestamp', () => {
    const before = [entry({ id: 'a', updated_at: '2026-08-20T10:00:00Z' })];
    const after = [entry({ id: 'a', updated_at: '2026-08-20T11:00:00Z' })];
    expect(diffEntries(before, after)).toBeNull();
  });

  it('treats a missing macro and a null macro as the same value', () => {
    const before = [entry({ id: 'a', protein_g: null })];
    const after = [entry({ id: 'a', protein_g: null })];
    expect(diffEntries(before, after)).toBeNull();
  });
});

describe('additionsOnly', () => {
  it('builds a card from a single read when there was no before-snapshot', () => {
    const day = [entry({ id: 'a' }), entry({ id: 'b', calories: 300 })];
    const diff = additionsOnly(day, ['b']);
    expect(diff?.added.map((i) => i.id)).toEqual(['b']);
    expect(diff?.delta.calories).toBe(300);
    expect(diff?.dayTotals.calories).toBe(500);
  });

  it('is null when none of the ids are in the day', () => {
    expect(additionsOnly([entry({ id: 'a' })], ['zz'])).toBeNull();
  });
});

describe('diffHeadline', () => {
  it('counts every kind of change and signs the calorie delta', () => {
    const diff = diffEntries(
      [entry({ id: 'a' })],
      [entry({ id: 'a', calories: 240 }), entry({ id: 'b', calories: 300 })]
    );
    expect(diffHeadline(diff!)).toBe('1 added · 1 updated · +340 kcal');
  });

  it('shows a removal as a fall in calories', () => {
    const diff = diffEntries([entry({ id: 'a' })], []);
    expect(diffHeadline(diff!)).toBe('1 removed · −200 kcal');
  });

  it('omits the calorie clause when the day is unchanged in kcal', () => {
    const diff = diffEntries([entry({ id: 'a' })], [entry({ id: 'a', meal_type: 'dinner' })]);
    expect(diffHeadline(diff!)).toBe('1 updated');
  });
});
