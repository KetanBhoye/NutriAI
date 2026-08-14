import { describe, expect, it } from 'vitest';
import { MEAL_SLOTS, reminderCopy, type SlotContext } from './copy';

const ctx = (over: Partial<SlotContext> = {}): SlotContext => ({
  meal: 'lunch',
  isToday: true,
  loggedMeals: [],
  remainingKcal: null,
  remainingProteinG: null,
  seed: '2026-08-14',
  ...over,
});

describe('MEAL_SLOTS', () => {
  it('fires at the agreed times, in order through the day', () => {
    expect(MEAL_SLOTS.map((s) => [s.meal, s.hour, s.minute])).toEqual([
      ['breakfast', 11, 0],
      ['lunch', 14, 0],
      ['snack', 18, 0],
      ['dinner', 20, 30],
    ]);
  });
});

describe('reminderCopy', () => {
  it('says nothing about a meal already logged', () => {
    // Nagging someone about a meal they logged is how notification permission
    // gets revoked.
    expect(reminderCopy(ctx({ meal: 'lunch', loggedMeals: ['breakfast', 'lunch'] }))).toBeNull();
  });

  it('nudges about the earlier meal that was missed', () => {
    const copy = reminderCopy(ctx({ meal: 'lunch', loggedMeals: [] }))!;

    expect(copy.title).toMatch(/Breakfast/);
    expect(copy.body).toMatch(/Breakfast/);
  });

  it('names the FIRST missed meal, not the most recent one', () => {
    // At dinner with only lunch logged, breakfast is the one to chase.
    const copy = reminderCopy(ctx({ meal: 'dinner', loggedMeals: ['lunch'] }))!;

    expect(copy.title).toMatch(/Breakfast/);
  });

  it('leads with what is left when the day is on track', () => {
    const copy = reminderCopy(
      ctx({ meal: 'dinner', loggedMeals: ['breakfast', 'lunch', 'snack'], remainingKcal: 620 })
    )!;

    expect(copy.body).toMatch(/620 kcal/);
  });

  it('mentions protein only when there is some still to hit', () => {
    const withProtein = reminderCopy(
      ctx({ meal: 'dinner', loggedMeals: ['breakfast', 'lunch', 'snack'], remainingKcal: 600, remainingProteinG: 45 })
    )!;
    const without = reminderCopy(
      ctx({ meal: 'dinner', loggedMeals: ['breakfast', 'lunch', 'snack'], remainingKcal: 600, remainingProteinG: 0 })
    )!;

    expect(withProtein.body).toMatch(/45g protein/);
    expect(without.body).not.toMatch(/protein/);
  });

  it('does not cheerfully invite more food once the budget is gone', () => {
    const copy = reminderCopy(
      ctx({ meal: 'dinner', loggedMeals: ['breakfast', 'lunch', 'snack'], remainingKcal: -150 })
    )!;

    expect(copy.body).not.toMatch(/kcal left/);
    // ...and doesn't shame them into not logging it either.
    expect(copy.body).toMatch(/Log it anyway/i);
  });

  it('never quotes live numbers on a future day', () => {
    // The text is fixed when scheduled, so tomorrow's "620 kcal left" would be
    // a lie on arrival.
    const copy = reminderCopy(ctx({ isToday: false, remainingKcal: 620, loggedMeals: [] }))!;

    expect(copy.body).not.toMatch(/620/);
    expect(copy.body.length).toBeGreaterThan(0);
  });

  it('always sends on a future day, even for a meal logged today', () => {
    const copy = reminderCopy(ctx({ isToday: false, meal: 'lunch', loggedMeals: ['lunch'] }));

    expect(copy).not.toBeNull();
  });

  it('varies wording across days but stays fixed within one', () => {
    const bodies = new Set(
      ['2026-08-14', '2026-08-15', '2026-08-16', '2026-08-17', '2026-08-18'].map(
        (seed) => reminderCopy(ctx({ isToday: false, seed }))!.body
      )
    );

    expect(bodies.size).toBeGreaterThan(1);
    expect(reminderCopy(ctx({ isToday: false }))).toEqual(reminderCopy(ctx({ isToday: false })));
  });

  it('produces something usable for every slot in every state', () => {
    for (const slot of MEAL_SLOTS) {
      for (const isToday of [true, false]) {
        const copy = reminderCopy(ctx({ meal: slot.meal, isToday, remainingKcal: 500 }));
        if (copy === null) continue;
        expect(copy.title.trim().length).toBeGreaterThan(0);
        expect(copy.body.trim().length).toBeGreaterThan(0);
        // A notification body that gets truncated mid-sentence reads as broken.
        expect(copy.body.length).toBeLessThan(180);
      }
    }
  });
});
