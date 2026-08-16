import { describe, expect, it } from 'vitest';
import { pickNudge, type NudgeContext } from './consequences';

const days = (n: number, calories: number, protein_g: number) =>
  Array.from({ length: n }, (_, i) => ({
    entry_date: `2026-08-${String(10 + i).padStart(2, '0')}`,
    calories,
    protein_g,
  }));

const ctx = (over: Partial<NudgeContext> = {}): NudgeContext => ({
  recent: days(5, 2000, 130),
  calorieGoal: 2000,
  proteinGoal: 130,
  losingWeight: true,
  trainedRecently: false,
  ...over,
});

describe('when to say nothing', () => {
  it('says nothing about a week that is going fine', () => {
    expect(pickNudge(ctx())).toBeNull();
  });

  it('says nothing from one bad day', () => {
    // Everybody has a Friday. Being told off for it is how people delete a
    // tracker.
    const recent = [...days(4, 2000, 130), { entry_date: '2026-08-15', calories: 3200, protein_g: 60 }];
    expect(pickNudge(ctx({ recent }))).toBeNull();
  });

  it('says nothing without enough logged days to read', () => {
    expect(pickNudge(ctx({ recent: days(2, 900, 40) }))).toBeNull();
  });

  it('says nothing about targets it has not been given', () => {
    // Fully logged days, but no goals to compare them against — there is
    // nothing truthful to say. (Days *below* the log threshold are a different
    // matter: a patchy log is worth mentioning whether or not goals exist.)
    expect(pickNudge(ctx({ calorieGoal: null, proteinGoal: null, recent: days(5, 2000, 90) }))).toBeNull();
  });
});

describe('protein short of target', () => {
  it('states the gap in their own numbers', () => {
    const n = pickNudge(ctx({ recent: days(5, 2000, 80) }));
    expect(n?.key).toBe('protein-short');
    expect(n?.because).toContain('80 g');
    expect(n?.because).toContain('130 g');
    expect(n?.because).toContain('50 g');
  });

  it('explains what a deficit does to the shortfall, not just that it exists', () => {
    const n = pickNudge(ctx({ recent: days(5, 2000, 80), losingWeight: true }));
    expect(n?.ifRepeated).toMatch(/fat or as muscle/);
  });

  it('changes the framing when they are not in a deficit', () => {
    const n = pickNudge(ctx({ recent: days(5, 2000, 80), losingWeight: false }));
    expect(n?.ifRepeated).toMatch(/built from/);
  });

  it('sizes the action to the actual gap', () => {
    const n = pickNudge(ctx({ recent: days(5, 2000, 80), trainedRecently: true }));
    expect(n?.action).toContain('50 g');
  });

  it('tolerates being a little under, which is normal', () => {
    expect(pickNudge(ctx({ recent: days(5, 2000, 120) }))).toBeNull();
  });
});

describe('eating over target', () => {
  it('converts the surplus into the weight it becomes', () => {
    // 500 over × 7 days ÷ 7700 = 0.45 kg a week.
    const n = pickNudge(ctx({ recent: days(5, 2500, 130), losingWeight: false }));
    expect(n?.key).toBe('over-target');
    expect(n?.ifRepeated).toContain('0.5 kg');
  });

  it('says what it does to a deficit plan specifically', () => {
    const n = pickNudge(ctx({ recent: days(5, 2500, 130), losingWeight: true }));
    expect(n?.ifRepeated).toMatch(/cancels most of the deficit/);
  });

  it('ignores a small overshoot', () => {
    expect(pickNudge(ctx({ recent: days(5, 2150, 130) }))).toBeNull();
  });
});

describe('eating well under target', () => {
  it('names the size of the deficit in kilograms a week', () => {
    // 2000 target, eating 1300: 700 short × 7 ÷ 7700 = 0.64 kg/week.
    const n = pickNudge(ctx({ recent: days(5, 1300, 130) }));
    expect(n?.key).toBe('under-eating');
    expect(n?.ifRepeated).toContain('0.6 kg');
  });

  it('warns about training before the scale, which is the order it happens in', () => {
    const n = pickNudge(ctx({ recent: days(5, 1300, 130) }));
    expect(n?.ifRepeated).toMatch(/flat training sessions/);
  });

  it('points at training days when they have been training', () => {
    const n = pickNudge(ctx({ recent: days(5, 1300, 130), trainedRecently: true }));
    expect(n?.action).toMatch(/days you train/);
  });

  it('outranks a protein shortfall, being the bigger problem', () => {
    const n = pickNudge(ctx({ recent: days(5, 1300, 60) }));
    expect(n?.key).toBe('under-eating');
  });
});

describe('gaps in the log', () => {
  it('reports missing days before commenting on numbers it cannot see', () => {
    const recent = [...days(2, 2000, 130), ...days(3, 0, 0)];
    const n = pickNudge(ctx({ recent }));
    expect(n?.key).toBe('not-logging');
    expect(n?.title).toContain('3 of the last 5');
  });

  it('explains the cost in terms of the plan, not guilt', () => {
    const recent = [...days(2, 2000, 130), ...days(3, 0, 0)];
    const n = pickNudge(ctx({ recent }));
    expect(n?.ifRepeated).toMatch(/fitting a rate/);
    expect(n?.action).toMatch(/especially those/);
  });
});

describe('never scolds', () => {
  it('avoids blame language in every nudge it can produce', () => {
    const all = [
      pickNudge(ctx({ recent: days(5, 2000, 80) })),
      pickNudge(ctx({ recent: days(5, 2500, 130) })),
      pickNudge(ctx({ recent: days(5, 1300, 130) })),
      pickNudge(ctx({ recent: [...days(2, 2000, 130), ...days(3, 0, 0)] })),
    ].filter(Boolean);

    expect(all).toHaveLength(4);
    for (const n of all) {
      const text = `${n!.title} ${n!.because} ${n!.ifRepeated} ${n!.action}`.toLowerCase();
      // Whole words: "badly" in "even the days that go badly" is fine, and a
      // substring check flags it. The thing being guarded against is blame,
      // not the letters.
      for (const word of ['failed', 'you should have', 'bad', 'lazy', 'guilty', 'shame']) {
        expect(text).not.toMatch(new RegExp(`\\b${word}\\b`));
      }
    }
  });

  it('always offers something to do about it', () => {
    const n = pickNudge(ctx({ recent: days(5, 2000, 80) }));
    expect(n?.action.length).toBeGreaterThan(20);
  });
});
