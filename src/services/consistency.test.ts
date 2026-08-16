import { describe, expect, it } from 'vitest';
import {
  bandFor,
  calorieAdherence,
  COMPARISON_FLOOR_PERCENTILE,
  headlineFor,
  MIN_DAYS_FOR_COMPARISON,
  MIN_POPULATION,
  movementAdherence,
  percentileOf,
  proteinAdherence,
  scoreDay,
  scoreWeek,
  shouldShowComparison,
  type DayInput,
  type Targets,
  weekDays,
  weekStartFor,
  previousWeekStart,
} from './consistency.js';

const TARGETS: Targets = { calories: 2000, proteinG: 150, stepGoal: 10000 };

const day = (over: Partial<DayInput> = {}): DayInput => ({
  date: '2026-08-17',
  calories: 2000,
  proteinG: 150,
  steps: 10000,
  ...over,
});

/** A full week of identical days, so week-level assertions are unambiguous. */
const week = (d: Partial<DayInput> = {}): DayInput[] =>
  Array.from({ length: 7 }, (_, i) => day({ ...d, date: `2026-08-${10 + i}` }));

describe('what the score rewards', () => {
  it('gives a perfect week 100', () => {
    expect(scoreWeek(week(), TARGETS).score).toBe(100);
  });

  it('gives a week with nothing logged 0', () => {
    expect(scoreWeek(week({ calories: 0, proteinG: 0, steps: 0 }), TARGETS).score).toBe(0);
  });

  it('does not reward one perfect day out of seven', () => {
    // The trap this metric exists to avoid: averaging only the logged days
    // would score this 100, which is the opposite of consistency.
    const days = [day(), ...Array.from({ length: 6 }, (_, i) => day({
      date: `2026-08-1${i + 1}`, calories: 0, proteinG: 0, steps: 0,
    }))];
    const result = scoreWeek(days, TARGETS);
    expect(result.score).toBeLessThan(20);
    expect(result.daysLogged).toBe(1);
  });

  it('scores five decent days above one flawless one', () => {
    const flawless = [day(), ...Array.from({ length: 6 }, (_, i) =>
      day({ date: `2026-08-2${i}`, calories: 0, proteinG: 0, steps: 0 }))];
    const decent = [
      ...Array.from({ length: 5 }, (_, i) =>
        day({ date: `2026-08-1${i}`, calories: 1800, proteinG: 120, steps: 7000 })),
      ...Array.from({ length: 2 }, (_, i) =>
        day({ date: `2026-08-2${i}`, calories: 0, proteinG: 0, steps: 0 })),
    ];
    expect(scoreWeek(decent, TARGETS).score).toBeGreaterThan(scoreWeek(flawless, TARGETS).score);
  });
});

describe('a day below the logging threshold', () => {
  it('does not count as logged', () => {
    // A single coffee is not a tracked day.
    const scored = scoreDay(day({ calories: 240, proteinG: 2, steps: 0 }), TARGETS);
    expect(scored.logged).toBe(false);
    expect(scored.total).toBe(0);
  });

  it('counts as logged once it is a real day of food', () => {
    expect(scoreDay(day({ calories: 1200 }), TARGETS).logged).toBe(true);
  });
});

describe('calorie adherence', () => {
  it('gives full credit inside the ±10% band', () => {
    // Tighter than the error in the calorie numbers themselves; demanding
    // better would be scoring noise.
    expect(calorieAdherence(2000, 2000)).toBe(1);
    expect(calorieAdherence(2180, 2000)).toBe(1);
    expect(calorieAdherence(1820, 2000)).toBe(1);
  });

  it('penalises under-eating as much as over-eating', () => {
    // Rewarding a very low day would teach exactly the wrong habit.
    expect(calorieAdherence(1400, 2000)).toBeCloseTo(calorieAdherence(2600, 2000), 5);
  });

  it('falls to zero at 40% off target', () => {
    expect(calorieAdherence(2800, 2000)).toBe(0);
    expect(calorieAdherence(1200, 2000)).toBe(0);
  });

  it('degrades smoothly rather than as a cliff', () => {
    const a = calorieAdherence(2200, 2000);
    const b = calorieAdherence(2300, 2000);
    const c = calorieAdherence(2400, 2000);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
  });
});

describe('protein', () => {
  it('gives full credit at goal', () => {
    expect(proteinAdherence(150, 150)).toBe(1);
  });

  it('does not pay extra for overshooting', () => {
    // No prize for 200% — offering one would push people at a number that is
    // not the goal.
    expect(proteinAdherence(300, 150)).toBe(1);
  });

  it('gives partial credit for a near miss', () => {
    expect(proteinAdherence(135, 150)).toBeGreaterThan(0.7);
  });

  it('gives nothing at half the goal', () => {
    expect(proteinAdherence(75, 150)).toBe(0);
  });
});

describe('movement is optional', () => {
  it('is not scored when the user has no step goal', () => {
    const noSteps: Targets = { calories: 2000, proteinG: 150, stepGoal: null };
    expect(scoreDay(day({ steps: 0 }), noSteps).movement).toBeNull();
  });

  it('does not penalise a user for a goal they never set', () => {
    // Otherwise everyone without a step goal is capped at 80.
    const noSteps: Targets = { calories: 2000, proteinG: 150, stepGoal: null };
    expect(scoreWeek(week({ steps: 0 }), noSteps).score).toBe(100);
  });

  it('does score it when the goal exists', () => {
    expect(scoreWeek(week({ steps: 0 }), TARGETS).score).toBeLessThan(100);
  });

  it('gives full credit for beating the goal', () => {
    expect(movementAdherence(15000, 10000)).toBe(1);
  });
});

describe('the percentile', () => {
  it('reports the share of members beaten', () => {
    expect(percentileOf(75, [10, 20, 30, 90])).toBe(75);
  });

  it('splits ties so an all-equal population sits at 50', () => {
    // Otherwise identical scores land at 0 or 100 depending on comparison
    // order, which is arbitrary and would read as a bug.
    expect(percentileOf(50, [50, 50, 50, 50])).toBe(50);
  });

  it('handles an empty population without dividing by zero', () => {
    expect(percentileOf(80, [])).toBe(50);
  });

  it('puts the best score near the top', () => {
    expect(percentileOf(100, [10, 20, 30, 40])).toBe(100);
  });
});

describe('when a comparison is shown at all', () => {
  const enough = Array.from({ length: MIN_POPULATION }, () => 50);

  it('stays hidden for a tiny population', () => {
    // "Better than 75%" of four people is one person having an off week.
    expect(shouldShowComparison(80, MIN_POPULATION - 1, 7)).toBe(false);
  });

  it('stays hidden when the user has barely logged', () => {
    expect(shouldShowComparison(80, enough.length, MIN_DAYS_FOR_COMPARISON - 1)).toBe(false);
  });

  it('stays hidden for someone in the bottom quarter', () => {
    // The deliberate asymmetry. Being told you are behind nearly everyone is
    // the shame finding in the research, and it lands on exactly the people
    // most likely to quit.
    expect(shouldShowComparison(COMPARISON_FLOOR_PERCENTILE - 1, enough.length, 7)).toBe(false);
  });

  it('shows for someone doing well with enough data', () => {
    expect(shouldShowComparison(72, enough.length, 5)).toBe(true);
  });

  it('shows right at the floor, not one above it', () => {
    expect(shouldShowComparison(COMPARISON_FLOOR_PERCENTILE, enough.length, 3)).toBe(true);
  });
});

describe('the words the user reads', () => {
  it('never labels the lowest band as failure', () => {
    // A label someone reads about themselves should describe a direction,
    // not deliver a verdict.
    expect(bandFor(10)).toBe('building');
    for (const score of [0, 10, 44]) {
      const { title, detail } = headlineFor(score, null, null);
      const text = `${title} ${detail}`.toLowerCase();
      for (const word of ['poor', 'bad', 'failed', 'failure', 'worst']) {
        expect(text).not.toContain(word);
      }
    }
  });

  it('celebrates a personal best', () => {
    expect(headlineFor(88, 70, 85).title).toBe('Your best week yet');
  });

  it('names a drop without scolding, and points forward', () => {
    const { title, detail } = headlineFor(60, 80, 90);
    expect(title).toBe('A quieter week');
    expect(detail).toContain('80');
    expect(`${title} ${detail}`.toLowerCase()).not.toContain('should');
    // Always leaves the user something to do.
    expect(detail).toMatch(/logged day/);
  });

  it('reports an improvement with the actual gain', () => {
    expect(headlineFor(75, 60, 90).detail).toContain('15');
  });

  it('bands the score sensibly', () => {
    expect(bandFor(90)).toBe('excellent');
    expect(bandFor(70)).toBe('strong');
    expect(bandFor(45)).toBe('steady');
    expect(bandFor(44)).toBe('building');
  });
});

describe('the same input always gives the same score', () => {
  it('is deterministic, so week-on-week comparison means something', () => {
    // The reason this is arithmetic and not a model: a score that moves on its
    // own cannot be compared to yourself last week.
    const days = week({ calories: 1900, proteinG: 130, steps: 8000 });
    const runs = Array.from({ length: 5 }, () => scoreWeek(days, TARGETS).score);
    expect(new Set(runs).size).toBe(1);
  });

  it('does not depend on the order days arrive in', () => {
    const days = week({ calories: 1900, proteinG: 130, steps: 8000 });
    const shuffled = [...days].reverse();
    expect(scoreWeek(shuffled, TARGETS).score).toBe(scoreWeek(days, TARGETS).score);
  });
});

describe('week boundaries', () => {
  it('starts weeks on Monday', () => {
    // 2026-08-17 is a Monday.
    expect(weekStartFor('2026-08-17')).toBe('2026-08-17');
    expect(weekStartFor('2026-08-20')).toBe('2026-08-17');
    expect(weekStartFor('2026-08-23')).toBe('2026-08-17'); // Sunday belongs to it
  });

  it('rolls over on Monday, not Sunday', () => {
    expect(weekStartFor('2026-08-24')).toBe('2026-08-24');
  });

  it('returns seven consecutive days', () => {
    expect(weekDays('2026-08-17')).toEqual([
      '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20',
      '2026-08-21', '2026-08-22', '2026-08-23',
    ]);
  });

  it('crosses a month boundary cleanly', () => {
    expect(weekDays('2026-07-27')).toContain('2026-08-02');
  });

  it('steps back a week', () => {
    expect(previousWeekStart('2026-08-17')).toBe('2026-08-10');
  });

  it('is timezone-proof', () => {
    // Computed in UTC on both sides. A local-Date version of this shifted
    // whole weeks for +05:30 users — the streak bug, one scale up.
    for (const d of ['2026-08-17', '2026-01-01', '2026-12-31']) {
      expect(weekStartFor(d)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(weekDays(weekStartFor(d))).toContain(d);
    }
  });
});
