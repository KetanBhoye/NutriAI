import { describe, expect, it } from 'vitest';
import {
  daysBetweenIso,
  paceForTargetDate,
  paceWarning,
  planShape,
  planStart,
  targetDateForPace,
} from './planStart';

const TODAY = '2026-08-27';

describe('planStart', () => {
  it('starts a brand-new plan today, at the current weight', () => {
    expect(planStart(75, null, TODAY)).toEqual({ start_weight_kg: 75, start_date: TODAY });
  });

  it('keeps an existing start when the weight has not moved', () => {
    // The line the user has been weighing in against. Redrawing it would throw
    // away every comparison the chart has made.
    const existing = { start_weight_kg: 75, start_date: '2026-08-01' };

    expect(planStart(75, existing, TODAY)).toEqual(existing);
  });

  it('ignores a difference too small to be a real weigh-in', () => {
    const existing = { start_weight_kg: 75, start_date: '2026-08-01' };

    expect(planStart(75.02, existing, TODAY)).toEqual(existing);
  });

  it('moves the date with the weight — the bug this file exists for', () => {
    // The editor used to bank today's weight as the start while leaving the
    // start date weeks in the past, so the glide path demanded the whole
    // remaining loss over a window that had mostly already elapsed. Saving the
    // editor without changing anything moved a nearly-on-track plan to "1.1 kg
    // behind".
    const existing = { start_weight_kg: 75, start_date: '2026-08-01' };

    expect(planStart(73, existing, TODAY)).toEqual({ start_weight_kg: 73, start_date: TODAY });
  });

  it('re-baselines a gain the same way it re-baselines a loss', () => {
    const existing = { start_weight_kg: 70, start_date: '2026-08-01' };

    expect(planStart(72, existing, TODAY)).toEqual({ start_weight_kg: 72, start_date: TODAY });
  });
});

describe('targetDateForPace', () => {
  it('dates the target from the plan start, not from today', () => {
    // 5 kg at 0.5 kg/week is 10 weeks from the start date.
    const start = { start_weight_kg: 75, start_date: '2026-08-01' };

    expect(targetDateForPace(start, 70, 0.5)).toBe('2026-10-10');
  });

  it('does not stretch an existing plan just because it was saved again', () => {
    // Dating from today instead would push the finish line out by however long
    // the plan had already been running — every single save.
    const start = { start_weight_kg: 75, start_date: '2026-08-01' };

    expect(targetDateForPace(start, 70, 0.5)).toBe(targetDateForPace(start, 70, 0.5));
  });

  it('handles a gain, where the pace sign is the other way round', () => {
    const start = { start_weight_kg: 70, start_date: '2026-08-01' };

    // 4 kg at 0.25 kg/week is 16 weeks — 112 days from 1 August.
    expect(targetDateForPace(start, 74, 0.25)).toBe('2026-11-21');
  });

  it('falls back when there is no pace or nothing to change', () => {
    const start = { start_weight_kg: 75, start_date: '2026-08-01' };

    expect(targetDateForPace(start, 75, 0.5)).toBe('2026-09-26');
    expect(targetDateForPace(start, 70, 0)).toBe('2026-09-26');
  });
});

describe('paceForTargetDate', () => {
  it('derives the weekly pace a chosen date implies', () => {
    const start = { start_weight_kg: 75, start_date: '2026-08-01' };

    // 5 kg over 70 days is 0.5 kg/week, losing.
    expect(paceForTargetDate(start, 70, '2026-10-10')).toBe(-0.5);
  });

  it('is positive for a plan that gains', () => {
    const start = { start_weight_kg: 70, start_date: '2026-08-01' };

    expect(paceForTargetDate(start, 74, '2026-11-21')).toBeCloseTo(0.25, 2);
  });

  it('round-trips with targetDateForPace', () => {
    const start = { start_weight_kg: 82, start_date: '2026-08-01' };
    const date = targetDateForPace(start, 76, 0.6);

    expect(paceForTargetDate(start, 76, date)).toBeCloseTo(-0.6, 1);
  });

  it('is null for a date that cannot describe a pace', () => {
    const start = { start_weight_kg: 75, start_date: '2026-08-01' };

    expect(paceForTargetDate(start, 70, '2026-08-01')).toBeNull();
    expect(paceForTargetDate(start, 70, '2026-07-01')).toBeNull();
  });

  it('is zero when there is nothing to change', () => {
    const start = { start_weight_kg: 75, start_date: '2026-08-01' };

    expect(paceForTargetDate(start, 75, '2026-10-10')).toBe(0);
  });
});

describe('paceWarning', () => {
  it('says nothing about a sensible pace', () => {
    expect(paceWarning(-0.5, 75)).toBeNull();
    expect(paceWarning(-0.75, 75)).toBeNull();
    expect(paceWarning(0.25, 75)).toBeNull();
    expect(paceWarning(0, 75)).toBeNull();
    expect(paceWarning(null, 75)).toBeNull();
  });

  it('flags a brisk cut without refusing it', () => {
    const warning = paceWarning(-1.1, 75);

    expect(warning).toMatch(/brisk/i);
    expect(warning).toMatch(/muscle/i);
  });

  it('pushes back on a crash diet', () => {
    expect(paceWarning(-2, 75)).toMatch(/faster than is usually safe/i);
  });

  it('scales the threshold with body weight', () => {
    // 1 kg/week is brisk at 75 kg and unremarkable at 120 kg.
    expect(paceWarning(-1.1, 75)).not.toBeNull();
    expect(paceWarning(-1.1, 120)).toBeNull();
  });

  it('flags a bulk that will mostly be fat', () => {
    expect(paceWarning(0.9, 75)).toMatch(/fat/i);
  });
});

describe('daysBetweenIso', () => {
  it('counts whole days', () => {
    expect(daysBetweenIso('2026-08-01', '2026-08-27')).toBe(26);
    expect(daysBetweenIso('2026-08-27', '2026-08-01')).toBe(-26);
    expect(daysBetweenIso('2026-08-27', '2026-08-27')).toBe(0);
  });

  it('crosses a month boundary correctly', () => {
    expect(daysBetweenIso('2026-08-30', '2026-09-02')).toBe(3);
  });
});

describe('planShape', () => {
  const existing = {
    start_weight_kg: 75,
    start_date: '2026-08-01',
    goal_weight_kg: 70,
    target_date: '2026-10-10',
  };

  const shape = (over: Partial<Parameters<typeof planShape>[0]> = {}) =>
    planShape(
      {
        currentWeightKg: 75,
        goal: null,
        typedGoalWeightKg: null,
        typedTargetDate: null,
        ratePerWeek: null,
        existing,
        ...over,
      },
      TODAY
    );

  it('carries a typed goal weight through — the "it saved the old plan" bug', () => {
    // The editor computed this inside the macro effect, so typing a goal
    // weight without also re-picking an activity level and a pace never
    // reached the form. Save then wrote the untouched plan back and the screen
    // redrew it, looking hardcoded.
    expect(shape({ typedGoalWeightKg: 68 }).goal_weight_kg).toBe(68);
  });

  it('carries a typed target date through on its own', () => {
    expect(shape({ typedTargetDate: '2026-12-01' }).target_date).toBe('2026-12-01');
  });

  it('keeps the saved goal when the field was left blank', () => {
    expect(shape({ goal: 'cut', ratePerWeek: 0.5 }).goal_weight_kg).toBe(70);
  });

  it('keeps the saved target date when nothing implies a new one', () => {
    expect(shape().target_date).toBe('2026-10-10');
  });

  it('derives the target date from a pace when one is chosen', () => {
    // 5 kg at 0.5 kg/week from the 1 August start.
    expect(shape({ goal: 'cut', ratePerWeek: 0.5 }).target_date).toBe('2026-10-10');
  });

  it('lets a typed date win over the pace', () => {
    expect(
      shape({ goal: 'cut', ratePerWeek: 0.5, typedTargetDate: '2026-11-30' }).target_date
    ).toBe('2026-11-30');
  });

  it('makes maintain aim at the current weight', () => {
    expect(shape({ goal: 'maintain', currentWeightKg: 73 }).goal_weight_kg).toBe(73);
  });

  it('moves the start as a pair when the weight has changed', () => {
    const result = shape({ currentWeightKg: 73, typedGoalWeightKg: 68 });

    expect(result.start_weight_kg).toBe(73);
    expect(result.start_date).toBe(TODAY);
  });

  it('starts a first plan from today', () => {
    const result = planShape(
      {
        currentWeightKg: 80,
        goal: 'cut',
        typedGoalWeightKg: 74,
        typedTargetDate: null,
        ratePerWeek: 0.5,
        existing: null,
      },
      TODAY
    );

    expect(result.start_date).toBe(TODAY);
    expect(result.goal_weight_kg).toBe(74);
    // 6 kg at 0.5/week is 12 weeks from today.
    expect(result.target_date).toBe('2026-11-19');
  });
});
