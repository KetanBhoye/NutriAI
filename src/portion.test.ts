import { describe, expect, it } from 'vitest';
import {
  defaultPortion,
  estimateGrams,
  formatGrams,
  gramStep,
  portionBasis,
  toGrams,
} from './portion';

describe('toGrams', () => {
  it('passes mass units through', () => {
    expect(toGrams(150, 'g')).toBe(150);
    expect(toGrams(1, 'kg')).toBe(1000);
  });

  it('converts household measures', () => {
    expect(toGrams(1, 'bowl')).toBe(200);
    expect(toGrams(2, 'roti')).toBe(90);
    expect(toGrams(1, 'cup')).toBe(240);
  });

  it('ignores case, plurals, spacing and full stops', () => {
    // Units arrive from the AI parser and the food library, not a fixed list.
    expect(toGrams(2, 'Rotis')).toBe(90);
    expect(toGrams(1, ' TBSP. ')).toBe(15);
    expect(toGrams(1, 'Grams')).toBe(5); // tidied up to the 5g floor
  });

  it("returns null for units that aren't a weight", () => {
    // "1 serving" can't be re-portioned, which is the whole reason grams exist.
    expect(toGrams(1, 'serving')).toBeNull();
    expect(toGrams(1, 'portion')).toBeNull();
    expect(toGrams(1, null)).toBeNull();
    expect(toGrams(1, '')).toBeNull();
  });

  it('returns null for a missing or non-positive quantity', () => {
    expect(toGrams(0, 'g')).toBeNull();
    expect(toGrams(-5, 'g')).toBeNull();
    expect(toGrams(null, 'g')).toBeNull();
  });

  it('rounds to a weight a person would type', () => {
    expect(toGrams(1.03, 'bowl')).toBe(210); // nearest 10 above 100g
    expect(toGrams(1.1, 'scoop')).toBe(35); // nearest 5 below 100g
  });

  it('clamps absurd weights rather than logging 40 kg of rice', () => {
    expect(toGrams(100, 'kg')).toBe(5000);
  });
});

describe('estimateGrams', () => {
  it('works back from macro mass', () => {
    // 35g of macros at ~35% dry matter ≈ 100g of cooked food.
    expect(estimateGrams({ calories: 200, protein_g: 10, carbs_g: 20, fat_g: 5 })).toBe(100);
  });

  it('falls back to calories when macros are missing', () => {
    // 1.5 kcal/g.
    expect(estimateGrams({ calories: 300 })).toBe(200);
  });

  it('assumes 100g when there is nothing to go on', () => {
    expect(estimateGrams({ calories: 0 })).toBe(100);
  });
});

describe('portionBasis', () => {
  const macros = { calories: 200, protein_g: 10, carbs_g: 20, fat_g: 5 };

  it('prefers the recorded weight and says it is exact', () => {
    expect(portionBasis(macros, 180, 'g')).toEqual({ grams: 180, exact: true });
  });

  it('estimates, and flags it, when the portion was never weighed', () => {
    const basis = portionBasis(macros, 1, 'serving');
    expect(basis.exact).toBe(false);
    expect(basis.grams).toBe(100);
  });

  it('never returns zero grams — callers divide by this', () => {
    // Per-gram macros are derived from this figure when re-portioning.
    expect(portionBasis({ calories: 0 }, null, null).grams).toBeGreaterThan(0);
  });
});

describe('defaultPortion', () => {
  const roti = {
    reference_unit: 'roti',
    default_quantity: 2,
    calories_per_unit: 120,
    protein_g_per_unit: 3,
    carbs_g_per_unit: 25,
    fat_g_per_unit: 1,
  };

  it('scales the macros by the default quantity', () => {
    const p = defaultPortion(roti);
    expect(p.calories).toBe(240);
    expect(p.protein_g).toBe(6);
  });

  it('weighs the portion in grams', () => {
    expect(defaultPortion(roti).grams).toBe(90); // 2 × 45g
  });

  it('keeps nulls null rather than turning them into zeros', () => {
    // A food with unknown fat should stay unknown, not claim 0g.
    const p = defaultPortion({ ...roti, fat_g_per_unit: null });
    expect(p.fat_g).toBeNull();
  });

  it('treats a missing default quantity as one', () => {
    expect(defaultPortion({ ...roti, default_quantity: 0 }).calories).toBe(120);
  });

  it('estimates a weight for foods measured in servings', () => {
    const p = defaultPortion({ ...roti, reference_unit: 'serving' });
    expect(p.grams).toBeGreaterThan(0);
  });
});

describe('gramStep', () => {
  it('steps coarsely for larger portions', () => {
    expect(gramStep(100)).toBe(10);
    expect(gramStep(250)).toBe(25);
  });
});

describe('formatGrams', () => {
  it('renders whole grams', () => {
    expect(formatGrams(150.4)).toBe('150g');
  });
});
