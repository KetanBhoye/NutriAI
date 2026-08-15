import { describe, expect, it } from 'vitest';
import {
  CONSERVATIVE_ESTIMATION_RULES,
  macroEnergy,
  reconcileMacros,
} from './macro-sanity.js';

describe('reconcileMacros', () => {
  it('leaves a consistent estimate exactly as it is', () => {
    // 2 rotis: 200 kcal, and 6×4 + 36×4 + 4×9 = 204 — within tolerance.
    const item = { calories: 200, protein_g: 6, carbs_g: 36, fat_g: 4 };
    expect(reconcileMacros(item)).toEqual(item);
  });

  it('scales an inflated estimate down to the calories it claims', () => {
    // The classic photo answer: a 350 kcal veg thali with 30 g of protein.
    // 30×4 + 60×4 + 10×9 = 450 kcal of macros in a 350 kcal plate.
    const fixed = reconcileMacros({ calories: 350, protein_g: 30, carbs_g: 60, fat_g: 10 });

    expect(fixed.calories).toBe(350);
    expect(fixed.protein_g).toBeLessThan(30);
    expect(macroEnergy(fixed)).toBeCloseTo(350, 0);
  });

  it('never scales an estimate up', () => {
    // Under-reporting is the acceptable direction, and "fixing" it would mean
    // inventing protein that may not be in the food.
    const lean = { calories: 500, protein_g: 10, carbs_g: 20, fat_g: 5 };
    expect(reconcileMacros(lean)).toEqual(lean);
  });

  it('tolerates the small overshoot that honest rounding produces', () => {
    // 4 kcal over on a 200 kcal item — a label rounding artefact, not inflation.
    const item = { calories: 200, protein_g: 5, carbs_g: 40, fat_g: 2.7 };
    expect(reconcileMacros(item)).toEqual(item);
  });

  it('does not let a high-protein food be flattened by the rule', () => {
    // 120 g chicken breast: protein is most of the energy, and correctly so.
    const chicken = { calories: 198, protein_g: 37, carbs_g: 0, fat_g: 4.3 };
    const fixed = reconcileMacros(chicken);
    expect(fixed.protein_g).toBeCloseTo(37, 0);
  });

  it('derives calories from the macros when the estimate forgot them', () => {
    // A zero-calorie entry carrying 30 g of protein corrupts the day silently.
    const fixed = reconcileMacros({ calories: 0, protein_g: 30, carbs_g: 10, fat_g: 5 });
    expect(fixed.calories).toBe(205);
    expect(fixed.protein_g).toBe(30);
  });

  it('treats a genuinely calorie-free item as calorie-free', () => {
    const fixed = reconcileMacros({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
    expect(fixed).toEqual({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
  });

  it('drops negative and non-numeric values rather than passing them on', () => {
    const fixed = reconcileMacros({
      calories: 100,
      protein_g: -5,
      carbs_g: Number.NaN,
      fat_g: 3,
    } as never);
    expect(fixed.protein_g).toBe(0);
    expect(fixed.carbs_g).toBe(0);
    expect(fixed.fat_g).toBe(3);
  });
});

describe('the shared estimation rules', () => {
  it('state the direction to err in, since that is the whole instruction', () => {
    expect(CONSERVATIVE_ESTIMATION_RULES).toMatch(/LOWER end/);
    expect(CONSERVATIVE_ESTIMATION_RULES).toMatch(/over-estimating is not/);
  });

  it('carry anchors for the food this user actually eats', () => {
    for (const food of ['Roti', 'Dal', 'Paneer', 'Curd']) {
      expect(CONSERVATIVE_ESTIMATION_RULES).toContain(food);
    }
  });

  it('keep every anchor internally consistent, or they teach the wrong thing', () => {
    // Each reference line is "N kcal, P g protein, C g carbs, F g fat" — a line
    // whose macros exceed its own calories would undo the rule above it.
    const lines = CONSERVATIVE_ESTIMATION_RULES.split('\n').filter((l) =>
      /: \d+(\.\d+)? kcal, /.test(l)
    );
    expect(lines.length).toBeGreaterThan(8);

    for (const line of lines) {
      const [, kcal, p, c, f] = line.match(
        /: (\d+(?:\.\d+)?) kcal, (\d+(?:\.\d+)?) g protein, (\d+(?:\.\d+)?) g carbs, (\d+(?:\.\d+)?) g fat/
      )!;
      const energy = macroEnergy({
        protein_g: Number(p),
        carbs_g: Number(c),
        fat_g: Number(f),
      });
      expect(energy).toBeLessThanOrEqual(Number(kcal) * 1.1);
    }
  });
});
