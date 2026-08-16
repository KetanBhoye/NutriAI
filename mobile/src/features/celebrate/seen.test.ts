import { describe, expect, it } from 'vitest';
import { rememberMoment, seenMoments } from './seen';

describe('remembering what has been celebrated', () => {
  it('starts with nothing', async () => {
    expect(await seenMoments('2026-08-17')).toEqual([]);
  });

  it('keeps a daily target from repeating within the day', async () => {
    await rememberMoment('protein-goal', '2026-08-17');
    expect(await seenMoments('2026-08-17')).toContain('protein-goal');
  });

  it('lets a daily target come round again tomorrow', async () => {
    await rememberMoment('protein-goal', '2026-08-17');
    // Hitting your protein goal two days running is worth two nods.
    expect(await seenMoments('2026-08-18')).not.toContain('protein-goal');
  });

  it('keeps a streak celebrated forever', async () => {
    await rememberMoment('streak-7', '2026-08-17');
    // Otherwise day eight, nine and ten all congratulate the same week.
    expect(await seenMoments('2026-09-30')).toContain('streak-7');
  });

  it('keeps a weight milestone forever', async () => {
    await rememberMoment('weight-halfway', '2026-08-17');
    expect(await seenMoments('2027-01-01')).toContain('weight-halfway');
  });

  it("does not lose yesterday's forever keys when a daily one is recorded", async () => {
    await rememberMoment('streak-7', '2026-08-17');
    await rememberMoment('protein-goal', '2026-08-18');

    const seen = await seenMoments('2026-08-18');
    expect(seen).toContain('streak-7');
    expect(seen).toContain('protein-goal');
  });

  it('keeps several daily keys from the same day', async () => {
    await rememberMoment('protein-goal', '2026-08-17');
    await rememberMoment('step-goal', '2026-08-17');

    const seen = await seenMoments('2026-08-17');
    expect(seen).toEqual(expect.arrayContaining(['protein-goal', 'step-goal']));
  });
});
