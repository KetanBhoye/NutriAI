import { describe, expect, it } from 'vitest';
import {
  ACTIVITY,
  FALLBACK_GOALS,
  RATE_OPTIONS,
  calcBMR,
  calcTDEE,
  computeMacros,
  dailyDelta,
  defaultRate,
  nearestRate,
} from './nutrition';

describe('calcBMR', () => {
  it('matches Mifflin-St Jeor for a man', () => {
    // 10(80) + 6.25(180) − 5(30) + 5 = 1780
    expect(calcBMR(80, 180, 30, 'male')).toBe(1780);
  });

  it('matches Mifflin-St Jeor for a woman', () => {
    // 10(60) + 6.25(165) − 5(30) − 161 = 1320.25 → 1320
    expect(calcBMR(60, 165, 30, 'female')).toBe(1320);
  });

  it('is the backend formula — the two must not drift apart', () => {
    // calculateBMR() in the backend's src/utils/calculations.ts rounds the same
    // expression: 700 + 1093.75 − 135 + 5 = 1663.75. If this figure moves, the
    // app and the coach start disagreeing about maintenance.
    expect(calcBMR(70, 175, 27, 'male')).toBe(1664);
  });
});

describe('calcTDEE', () => {
  it('applies the activity multiplier', () => {
    expect(calcTDEE(1700, 'sedentary')).toBe(Math.round(1700 * 1.2));
    expect(calcTDEE(1700, 'very_active')).toBe(Math.round(1700 * 1.9));
  });

  it('rises monotonically with activity', () => {
    const levels = Object.keys(ACTIVITY) as Array<keyof typeof ACTIVITY>;
    const values = levels.map((l) => calcTDEE(1700, l));
    expect([...values].sort((a, b) => a - b)).toEqual(values);
  });
});

describe('computeMacros', () => {
  it('subtracts the rate-implied deficit for a cut', () => {
    // 0.5 kg/week = 3850 kcal/week = 550/day.
    const { calories } = computeMacros(2500, 80, 'cut', 0.5);
    expect(calories).toBe(1950);
  });

  it('adds a surplus for a bulk', () => {
    const { calories } = computeMacros(2500, 80, 'lean_bulk', 0.2);
    expect(calories).toBeGreaterThan(2500);
  });

  it('ignores the rate for maintain', () => {
    expect(computeMacros(2500, 80, 'maintain', 1).calories).toBe(2500);
  });

  it('never drops below 1200 kcal, however aggressive the rate', () => {
    // A small person on an aggressive cut would otherwise be told to eat ~600.
    expect(computeMacros(1500, 45, 'cut', 1).calories).toBe(1200);
  });

  it('rounds calories to the nearest 10', () => {
    expect(computeMacros(2333, 70, 'maintain').calories % 10).toBe(0);
  });

  it('scales protein with body weight and goal', () => {
    // Cut protects muscle with 2.2 g/kg; maintain sits lower at 1.8.
    expect(computeMacros(2500, 80, 'cut', 0.5).protein_g).toBe(176);
    expect(computeMacros(2500, 80, 'maintain').protein_g).toBe(144);
  });

  it('splits the remaining calories into fat and carbs', () => {
    const m = computeMacros(2500, 80, 'cut', 0.5);
    const fromMacros = m.protein_g * 4 + m.carbs_g * 4 + m.fat_g * 9;
    // Rounding each macro to a whole gram costs a few kcal, no more.
    expect(Math.abs(fromMacros - m.calories)).toBeLessThan(15);
  });

  it('never returns negative carbs', () => {
    // A very heavy person on a floored calorie target: protein and fat alone
    // can exceed the budget, and carbs must clamp at zero rather than go under.
    expect(computeMacros(1500, 150, 'cut', 1).carbs_g).toBeGreaterThanOrEqual(0);
  });
});

describe('dailyDelta', () => {
  it('converts a weekly rate to a daily calorie change', () => {
    expect(dailyDelta(0.5)).toBe(550); // 0.5 × 7700 ÷ 7
    expect(dailyDelta(0)).toBe(0);
  });
});

describe('defaultRate', () => {
  it('picks the standard option for each goal', () => {
    expect(defaultRate('cut')).toBe(0.7);
    expect(defaultRate('lean_bulk')).toBe(0.35);
  });

  it('is zero for maintain, which has no pace', () => {
    expect(defaultRate('maintain')).toBe(0);
  });
});

describe('nearestRate', () => {
  it('snaps a plan-implied rate to the closest offered option', () => {
    // A plan losing 0.62 kg/week is "0.7 — Standard", not the 0.5 next to it.
    expect(nearestRate('cut', 0.62)).toBe(0.7);
    expect(nearestRate('cut', 0.55)).toBe(0.5);
  });

  it('returns an exact option unchanged', () => {
    for (const option of RATE_OPTIONS.cut) {
      expect(nearestRate('cut', option.kg)).toBe(option.kg);
    }
  });

  it('falls back to the default for a nonsensical rate', () => {
    // A plan whose dates make the implied rate zero or negative.
    expect(nearestRate('cut', 0)).toBe(defaultRate('cut'));
    expect(nearestRate('cut', -1)).toBe(defaultRate('cut'));
    expect(nearestRate('cut', Number.NaN)).toBe(defaultRate('cut'));
  });

  it('is zero for maintain rather than inventing a pace', () => {
    expect(nearestRate('maintain', 0.5)).toBe(0);
  });
});

describe('FALLBACK_GOALS', () => {
  it('is the single set the whole app falls back to', () => {
    // Today and Trends each had their own (2000 vs 1900), so a user with no
    // targets watched one screen count down from a number the other didn't use.
    expect(FALLBACK_GOALS.calories).toBe(2000);
  });

  it('is internally consistent', () => {
    const fromMacros =
      FALLBACK_GOALS.protein_g * 4 + FALLBACK_GOALS.carbs_g * 4 + FALLBACK_GOALS.fat_g * 9;
    expect(Math.abs(fromMacros - FALLBACK_GOALS.calories)).toBeLessThan(100);
  });
});
