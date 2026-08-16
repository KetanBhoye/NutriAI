import { describe, expect, it } from 'vitest';
import { genericWeeklyNotice, weeklyNotice, type WeekSummary } from './weeklyCopy';

const week = (over: Partial<WeekSummary> = {}): WeekSummary => ({
  daysLogged: 6,
  daysOnCalorieTarget: 4,
  avgProteinG: 110,
  proteinGoalG: 130,
  weightChangeKg: null,
  losingWeight: true,
  streakDays: 3,
  ...over,
});

describe('what makes it worth tapping', () => {
  it('leads with a real change on the scale, the thing people care about most', () => {
    const n = weeklyNotice(week({ weightChangeKg: -0.6 }));
    expect(n.title).toContain('0.6 kg down');
  });

  it('does not congratulate a move in the wrong direction', () => {
    // Gaining while trying to lose is not a win, and calling it one is how an
    // app stops being believed.
    const n = weeklyNotice(week({ weightChangeKg: 0.7, losingWeight: true }));
    expect(n.title).not.toMatch(/up this week/);
    expect(n.body).toContain('0.7 kg');
    expect(n.body).toMatch(/likely reason/);
  });

  it('reads a gain as good when the plan is to gain', () => {
    const n = weeklyNotice(week({ weightChangeKg: 0.5, losingWeight: false }));
    expect(n.title).toContain('0.5 kg up');
  });

  it('ignores scale noise', () => {
    // A 0.1 kg move is water, not progress.
    const n = weeklyNotice(week({ weightChangeKg: -0.1 }));
    expect(n.title).not.toContain('kg');
  });

  it('quotes the streak when there is one worth quoting', () => {
    const n = weeklyNotice(week({ streakDays: 12 }));
    expect(n.title).toContain('12 days');
  });

  it('quotes real protein numbers when the week beat the target', () => {
    const n = weeklyNotice(week({ avgProteinG: 142, proteinGoalG: 130, streakDays: 2 }));
    expect(n.title).toContain('142 g');
    expect(n.body).toContain('130 g');
  });

  it('always leaves a reason to open it, not just an announcement', () => {
    const all = [
      weeklyNotice(week({ weightChangeKg: -0.6 })),
      weeklyNotice(week({ streakDays: 9 })),
      weeklyNotice(week({ avgProteinG: 142, proteinGoalG: 130, streakDays: 1 })),
      weeklyNotice(week({ daysOnCalorieTarget: 6, streakDays: 1, avgProteinG: 90 })),
      weeklyNotice(week({ daysOnCalorieTarget: 1, streakDays: 1, avgProteinG: 90 })),
    ];
    for (const n of all) {
      // Every one has to end somewhere the report answers.
      expect(n.body.length).toBeGreaterThan(30);
      expect(n.title.length).toBeLessThan(48);
    }
  });
});

describe('an empty week', () => {
  it('says so without scolding, and gives a way back in', () => {
    const n = weeklyNotice(week({ daysLogged: 0 }));
    expect(n.body).toMatch(/one day is enough/i);
    for (const word of ['failed', 'missed out', 'should']) {
      expect(`${n.title} ${n.body}`.toLowerCase()).not.toContain(word);
    }
  });
});

describe('weeks that have not happened yet', () => {
  it('promises nothing specific, because the text is fixed weeks early', () => {
    // A local notification's copy is set when it is scheduled. Claiming "your
    // best week yet" for a week nobody has lived is a lie the app cannot
    // retract once it is in the tray.
    for (let i = 0; i < 4; i += 1) {
      const n = genericWeeklyNotice(i);
      expect(n.title).not.toMatch(/\d/);
      expect(n.body).not.toMatch(/\d+ ?(kg|g\b)/);
    }
  });

  it('rotates, so a month of Sundays is not the same sentence', () => {
    const titles = new Set([0, 1, 2, 3].map((i) => genericWeeklyNotice(i).title));
    expect(titles.size).toBe(4);
  });

  it('wraps around rather than running out', () => {
    expect(genericWeeklyNotice(4).title).toBe(genericWeeklyNotice(0).title);
  });
});
