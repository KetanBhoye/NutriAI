import { describe, expect, it } from 'vitest';
import { isDailyMoment, pickMoment, type DayState } from './moments';

const day = (over: Partial<DayState> = {}): DayState => ({
  totals: { calories: 1200, protein_g: 60, carbs_g: 120, fat_g: 40 },
  proteinGoal: 130,
  steps: 4000,
  stepGoal: 10000,
  loggedMeals: ['breakfast'],
  streakDays: 1,
  weight: null,
  ...over,
});

describe('what earns a celebration', () => {
  it('says nothing on an ordinary day', () => {
    // The default state is someone mid-way through a normal day. Celebrating
    // here is what turns the feature into wallpaper.
    expect(pickMoment(day(), [])).toBeNull();
  });

  it('marks the protein target, which is the one people chase', () => {
    const m = pickMoment(day({ totals: { calories: 1800, protein_g: 132, carbs_g: 150, fat_g: 50 } }), []);
    expect(m?.key).toBe('protein-goal');
    expect(m?.detail).toContain('132 g');
  });

  it('marks the step goal against the plan\'s own target', () => {
    const m = pickMoment(day({ steps: 11200 }), []);
    expect(m?.key).toBe('step-goal');
    expect(m?.detail).toContain('11,200');
  });

  it('marks a day where every meal was logged', () => {
    const m = pickMoment(day({ loggedMeals: ['breakfast', 'lunch', 'dinner', 'snack'] }), []);
    expect(m?.key).toBe('full-day');
  });

  it('does not celebrate merely logging something', () => {
    expect(pickMoment(day({ loggedMeals: ['breakfast', 'lunch'] }), [])).toBeNull();
  });
});

describe('only one thing at a time, rarest first', () => {
  it('prefers a weight milestone over a daily target', () => {
    const m = pickMoment(
      day({
        totals: { calories: 1800, protein_g: 140, carbs_g: 150, fat_g: 50 },
        steps: 12000,
        weight: { startKg: 80, goalKg: 70, currentKg: 74.9 },
      }),
      []
    );
    expect(m?.key).toBe('weight-halfway');
  });

  it('prefers a streak over a daily target', () => {
    const m = pickMoment(day({ streakDays: 7, steps: 12000 }), []);
    expect(m?.key).toBe('streak-7');
  });

  it('reports only the longest streak reached, not every one below it', () => {
    const m = pickMoment(day({ streakDays: 30 }), []);
    expect(m?.key).toBe('streak-30');
  });

  it('falls through to the next unseen moment once one is used up', () => {
    const state = day({ streakDays: 7, steps: 12000 });
    expect(pickMoment(state, ['streak-7'])?.key).toBe('step-goal');
  });
});

describe('never twice', () => {
  it('stays silent about something already celebrated', () => {
    const state = day({ totals: { calories: 1800, protein_g: 140, carbs_g: 150, fat_g: 50 } });
    expect(pickMoment(state, ['protein-goal'])).toBeNull();
  });

  it('treats daily targets as daily and streaks as once in a lifetime', () => {
    // Celebrating "7-day streak" on day 8, 9, 10… is exactly how this feature
    // becomes something people swipe away without reading.
    expect(isDailyMoment('protein-goal')).toBe(true);
    expect(isDailyMoment('step-goal')).toBe(true);
    expect(isDailyMoment('full-day')).toBe(true);
    expect(isDailyMoment('streak-7')).toBe(false);
    expect(isDailyMoment('weight-goal')).toBe(false);
  });
});

describe('weight milestones', () => {
  it('marks reaching the goal weight', () => {
    const m = pickMoment(day({ weight: { startKg: 80, goalKg: 70, currentKg: 69.8 } }), []);
    expect(m?.key).toBe('weight-goal');
  });

  it('works for gaining as well as losing', () => {
    const m = pickMoment(day({ weight: { startKg: 60, goalKg: 68, currentKg: 68.4 } }), []);
    expect(m?.key).toBe('weight-goal');
  });

  it('says nothing for a plan that goes nowhere', () => {
    // Goal equal to start: there is no progress to be halfway through, and
    // congratulating someone for standing still is worse than silence.
    expect(pickMoment(day({ weight: { startKg: 71.2, goalKg: 71.2, currentKg: 71.2 } }), [])).toBeNull();
  });

  it('does not call it halfway before it is', () => {
    expect(pickMoment(day({ weight: { startKg: 80, goalKg: 70, currentKg: 77 } }), [])).toBeNull();
  });
});

describe('missing data', () => {
  it('says nothing when there is no protein goal to beat', () => {
    const state = day({ proteinGoal: null, totals: { calories: 1800, protein_g: 300, carbs_g: 1, fat_g: 1 } });
    expect(pickMoment(state, [])).toBeNull();
  });

  it('says nothing about steps when none have been recorded', () => {
    expect(pickMoment(day({ steps: null, stepGoal: 10000 }), [])).toBeNull();
  });

  it('says nothing about steps when the plan sets no target', () => {
    expect(pickMoment(day({ steps: 30000, stepGoal: null }), [])).toBeNull();
  });
});
