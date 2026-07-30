import { describe, expect, it } from 'vitest';
import {
  buildDeficitSeries,
  buildGlidePath,
  planProgress,
  weeklyDeficit,
  type WeighIn,
} from './goal-progress.js';
import type { GoalPlan } from '../repositories/goal-plan.repository.js';

const CUT: GoalPlan = {
  id: 'p1',
  start_weight_kg: 70.7,
  start_date: '2026-07-19',
  goal_weight_kg: 68,
  target_date: '2026-08-30',
  tolerance_kg: 0.3,
  daily_step_goal: 15000,
  weekly_training_days: 6,
};

describe('buildGlidePath', () => {
  it('descends from start to goal and lands exactly on target', () => {
    const path = buildGlidePath(CUT, []);

    expect(path[0]!.target_kg).toBe(70.7);
    expect(path[path.length - 1]!.target_kg).toBe(68);
    expect(path[path.length - 1]!.date).toBe('2026-08-30');
  });

  it('spaces weeks seven days apart', () => {
    const path = buildGlidePath(CUT, []);
    expect(path[0]!.date).toBe('2026-07-19');
    expect(path[1]!.date).toBe('2026-07-26');
    expect(path[2]!.date).toBe('2026-08-02');
  });

  it('matches a weigh-in within three days of the week marker', () => {
    const weighIns: WeighIn[] = [{ recorded_date: '2026-07-27', weight_kg: 70.2 }];
    const path = buildGlidePath(CUT, weighIns);

    expect(path[1]!.actual_kg).toBe(70.2);
    expect(path[1]!.status).toBe('on');
  });

  it('leaves a week empty rather than borrowing a distant reading', () => {
    // A reading 10 days away says nothing about this week.
    const path = buildGlidePath(CUT, [{ recorded_date: '2026-08-05', weight_kg: 69.5 }]);

    expect(path[1]!.actual_kg).toBeNull();
    expect(path[1]!.status).toBe('empty');
  });

  it('prefers the closest reading when several are in range', () => {
    const path = buildGlidePath(CUT, [
      { recorded_date: '2026-07-24', weight_kg: 70.5 },
      { recorded_date: '2026-07-26', weight_kg: 70.1 },
    ]);

    expect(path[1]!.actual_kg).toBe(70.1);
  });

  it('grades a cut: below target is ahead, above is behind', () => {
    const ahead = buildGlidePath(CUT, [{ recorded_date: '2026-07-26', weight_kg: 69.5 }]);
    const behind = buildGlidePath(CUT, [{ recorded_date: '2026-07-26', weight_kg: 71.2 }]);

    expect(ahead[1]!.status).toBe('ahead');
    expect(behind[1]!.status).toBe('behind');
  });

  it('flips the grading for a bulk', () => {
    // Gaining: above the target line is ahead, not behind.
    const bulk: GoalPlan = {
      ...CUT,
      start_weight_kg: 68,
      goal_weight_kg: 72,
    };
    const path = buildGlidePath(bulk, [{ recorded_date: '2026-07-26', weight_kg: 69.5 }]);

    expect(path[1]!.status).toBe('ahead');
  });

  it('ignores weigh-ins with no weight recorded', () => {
    const path = buildGlidePath(CUT, [{ recorded_date: '2026-07-26', weight_kg: null }]);
    expect(path[1]!.actual_kg).toBeNull();
  });

  it('returns nothing for a target date on or before the start', () => {
    expect(buildGlidePath({ ...CUT, target_date: '2026-07-19' }, [])).toEqual([]);
  });
});

describe('buildDeficitSeries', () => {
  it('computes deficit as TDEE minus intake', () => {
    const [day] = buildDeficitSeries(
      new Map([['2026-07-18', 1800]]),
      new Map([['2026-07-15', 2800]]),
      null
    );

    expect(day!.deficit_kcal).toBe(1000);
  });

  it('carries forward the most recent TDEE at or before the day', () => {
    const days = buildDeficitSeries(
      new Map([
        ['2026-07-10', 1800],
        ['2026-07-20', 1800],
      ]),
      new Map([
        ['2026-07-01', 2600],
        ['2026-07-15', 2900],
      ]),
      null
    );

    expect(days[0]!.expenditure_kcal).toBe(2600);
    expect(days[1]!.expenditure_kcal).toBe(2900);
  });

  it('reports null rather than guessing when no TDEE is known', () => {
    const [day] = buildDeficitSeries(new Map([['2026-07-18', 1800]]), new Map(), null);
    expect(day!.deficit_kcal).toBeNull();
  });
});

describe('buildDeficitSeries with logged exercise', () => {
  const intake = new Map([['2026-07-17', 1800]]);
  const tdee = new Map([['2026-07-17', 2400]]);

  it('counts nothing extra on a day with no logged session', () => {
    const [day] = buildDeficitSeries(intake, tdee, null);
    expect(day!.expenditure_kcal).toBe(2400);
    expect(day!.exercise_kcal).toBe(0);
    expect(day!.deficit_kcal).toBe(600);
  });

  it('adds a logged session to that day\'s expenditure', () => {
    // The activity level can't have anticipated Tuesday's football match.
    const exercise = new Map([['2026-07-17', 330]]);
    const [day] = buildDeficitSeries(intake, tdee, null, exercise);

    expect(day!.expenditure_kcal).toBe(2730);
    expect(day!.exercise_kcal).toBe(330);
    expect(day!.deficit_kcal).toBe(930);
  });

  it('ignores exercise logged on a day with no food logged', () => {
    // A day with no intake isn't a day we can compute a balance for at all.
    const exercise = new Map([['2026-07-18', 400]]);
    const days = buildDeficitSeries(intake, tdee, null, exercise);

    expect(days).toHaveLength(1);
    expect(days[0]!.exercise_kcal).toBe(0);
  });

  it('still reports no deficit when the TDEE is unknown', () => {
    const exercise = new Map([['2026-07-17', 330]]);
    const [day] = buildDeficitSeries(intake, new Map(), null, exercise);

    // Exercise alone can't produce a balance without a maintenance figure.
    expect(day!.expenditure_kcal).toBeNull();
    expect(day!.deficit_kcal).toBeNull();
  });
});

describe('weeklyDeficit', () => {
  const dayFor = (date: string, deficit: number) => ({
    date,
    intake_kcal: 1800,
    expenditure_kcal: 1800 + deficit,
    exercise_kcal: 0,
    deficit_kcal: deficit,
  });

  it('sums a full week and projects the loss', () => {
    // 7 x 700 = 4900 kcal ≈ 0.64 kg
    const days = [
      '2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16',
      '2026-07-17', '2026-07-18', '2026-07-19',
    ].map((d) => dayFor(d, 700));

    const [week] = weeklyDeficit(days);

    expect(week!.week_start).toBe('2026-07-13');
    expect(week!.days_logged).toBe(7);
    expect(week!.total_deficit).toBe(4900);
    expect(week!.projected_kg).toBeCloseTo(0.64, 2);
  });

  it('drops weeks with too few logged days', () => {
    // Two days is not a week; reporting it would show a deficit that mostly
    // reflects the days that went unlogged.
    const days = [dayFor('2026-07-13', 700), dayFor('2026-07-14', 700)];
    expect(weeklyDeficit(days)).toEqual([]);
  });

  it('groups into Monday-start weeks', () => {
    const days = [
      // Sunday belongs to the week that began the previous Monday.
      dayFor('2026-07-19', 500),
      dayFor('2026-07-18', 500),
      dayFor('2026-07-17', 500),
      dayFor('2026-07-16', 500),
    ];

    const [week] = weeklyDeficit(days);
    expect(week!.week_start).toBe('2026-07-13');
  });

  it('skips days with an unknown deficit', () => {
    const days = [
      ...['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16'].map((d) => dayFor(d, 600)),
      { date: '2026-07-17', intake_kcal: 1800, expenditure_kcal: null, exercise_kcal: 0, deficit_kcal: null },
    ];

    const [week] = weeklyDeficit(days);
    expect(week!.days_logged).toBe(4);
    expect(week!.total_deficit).toBe(2400);
  });
});

describe('planProgress', () => {
  /** Daily readings starting `from`, moving `perDay` kg each day. */
  const series = (from: string, start: number, perDay: number, days: number): WeighIn[] =>
    Array.from({ length: days }, (_, i) => {
      const d = new Date(Date.UTC(2026, 0, 1));
      const [y, m, day] = from.split('-').map(Number);
      d.setUTCFullYear(y!, (m ?? 1) - 1, (day ?? 1) + i);
      return {
        recorded_date: d.toISOString().split('T')[0]!,
        weight_kg: Math.round((start + perDay * i) * 100) / 100,
      };
    });

  it('reads the baseline off the plan line for the day', () => {
    // 42-day plan losing 2.7 kg; three weeks in is half of it.
    const p = planProgress(CUT, [], '2026-08-09');
    expect(p.baseline_kg).toBeCloseTo(69.35, 2);
    expect(p.days_elapsed).toBe(21);
    expect(p.days_remaining).toBe(21);
  });

  it('has nothing to compare without a weigh-in', () => {
    const p = planProgress(CUT, [], '2026-08-09');
    expect(p.actual_kg).toBeNull();
    expect(p.status).toBe('empty');
    expect(p.suggested_calorie_delta).toBeNull();
  });

  it('smooths the current weight over the last week of readings', () => {
    const weighIns: WeighIn[] = [
      { recorded_date: '2026-08-06', weight_kg: 69.6 },
      { recorded_date: '2026-08-08', weight_kg: 69.2 },
      // A single salty day shouldn't move the verdict on its own.
      { recorded_date: '2026-08-09', weight_kg: 70.3 },
    ];
    const p = planProgress(CUT, weighIns, '2026-08-09');

    expect(p.readings_used).toBe(3);
    expect(p.actual_kg).toBeCloseTo(69.7, 2);
  });

  it('flags being behind, and being ahead, in the direction of the goal', () => {
    const behind = planProgress(CUT, [{ recorded_date: '2026-08-09', weight_kg: 70.5 }], '2026-08-09');
    expect(behind.status).toBe('behind');
    expect(behind.delta_kg).toBeCloseTo(1.15, 2);

    const ahead = planProgress(CUT, [{ recorded_date: '2026-08-09', weight_kg: 68.5 }], '2026-08-09');
    expect(ahead.status).toBe('ahead');
    expect(ahead.delta_kg).toBeCloseTo(-0.85, 2);
  });

  it('fits the trend rate from recent readings', () => {
    // 0.1 kg/day down = 0.7 kg/week.
    const p = planProgress(CUT, series('2026-07-26', 70.4, -0.1, 15), '2026-08-09');
    expect(p.actual_rate_kg_per_week).toBeCloseTo(-0.7, 2);
  });

  it('refuses a rate from readings that span less than a week', () => {
    const p = planProgress(CUT, series('2026-08-07', 70.4, -0.1, 3), '2026-08-09');
    expect(p.actual_rate_kg_per_week).toBeNull();
    expect(p.suggested_calorie_delta).toBeNull();
  });

  it('projects the goal date from the measured rate', () => {
    const p = planProgress(CUT, series('2026-07-26', 70.4, -0.1, 15), '2026-08-09');
    expect(p.projected_goal_date).not.toBeNull();
    // Losing faster than the plan needs lands early.
    expect(p.days_off_plan!).toBeLessThan(0);
  });

  it('has no goal date when the trend moves away from the goal', () => {
    const p = planProgress(CUT, series('2026-07-26', 68.5, 0.1, 15), '2026-08-09');
    expect(p.actual_rate_kg_per_week).toBeGreaterThan(0);
    expect(p.projected_goal_date).toBeNull();
  });

  it('suggests eating less when the trend is short of what the plan needs', () => {
    // Flat weight with 2.5 kg still to lose in three weeks.
    const p = planProgress(CUT, series('2026-07-26', 70.5, 0, 15), '2026-08-09');
    expect(p.suggested_calorie_delta!).toBeLessThan(0);
  });

  it('suggests nothing while the trend already matches the plan', () => {
    // Plan needs 0.45 kg/week; match it and land on the baseline.
    const p = planProgress(CUT, series('2026-07-26', 70.0, -0.064, 15), '2026-08-09');
    expect(p.suggested_calorie_delta).toBe(0);
  });

  it('never suggests a swing bigger than 400 kcal', () => {
    const p = planProgress(CUT, series('2026-07-26', 74, 0.2, 15), '2026-08-09');
    expect(p.suggested_calorie_delta).toBe(-400);
  });

  it('stops suggesting once the plan has run out of days', () => {
    const p = planProgress(CUT, series('2026-08-17', 69.5, -0.05, 14), '2026-08-30');
    expect(p.days_remaining).toBe(0);
    expect(p.required_rate_kg_per_week).toBeNull();
    expect(p.suggested_calorie_delta).toBeNull();
  });
});
