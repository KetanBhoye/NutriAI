import { describe, expect, it } from 'vitest';
import { buildEntryChanges, macroValue, type EntryEditForm } from './entryChanges';

/**
 * The rules here are the ones that lost a user's edit: a blank macro was sent
 * as `null`, `PATCH /api/entries/:id` refused the whole body, and the queue
 * dropped the 4xx silently — so the calorie change appeared to save and then
 * reverted on the next refresh.
 */

const form = (over: Partial<EntryEditForm> = {}): EntryEditForm => ({
  name: 'Dal',
  calories: '320',
  protein: '',
  carbs: '',
  fat: '',
  meal: 'lunch',
  ...over,
});

describe('macroValue', () => {
  it('sends a filled field as a number', () => {
    expect(macroValue('24', null)).toBe(24);
    expect(macroValue(' 24.5 ', null)).toBe(24.5);
  });

  it('omits a blank field the entry never had', () => {
    // undefined means "not in the payload at all".
    expect(macroValue('', null)).toBeUndefined();
    expect(macroValue('', undefined)).toBeUndefined();
    expect(macroValue('   ', null)).toBeUndefined();
  });

  it('sends null only when clearing a value that existed', () => {
    expect(macroValue('', 24)).toBeNull();
  });

  it('treats a cleared zero as a real value worth clearing', () => {
    expect(macroValue('', 0)).toBeNull();
  });

  it('omits unparseable text rather than sending NaN', () => {
    expect(macroValue('abc', 24)).toBeUndefined();
  });
});

describe('buildEntryChanges', () => {
  it('sends the edited calories', () => {
    expect(buildEntryChanges(form({ calories: '450' }), {}, 150)).toMatchObject({ calories: 450 });
  });

  it('rounds calories, which the API requires to be an integer', () => {
    expect(buildEntryChanges(form({ calories: '450.6' }), {}, 150)!.calories).toBe(451);
  });

  it('omits blank macros for an entry logged without them', () => {
    const changes = buildEntryChanges(form(), {}, 150)!;

    // This is the regression: `protein_g: null` here 400'd the whole update.
    expect('protein_g' in stripUndefined(changes)).toBe(false);
    expect('carbs_g' in stripUndefined(changes)).toBe(false);
    expect('fat_g' in stripUndefined(changes)).toBe(false);
  });

  it('clears a macro the user emptied on purpose', () => {
    const changes = buildEntryChanges(form({ protein: '' }), { protein_g: 24 }, 150)!;
    expect(changes.protein_g).toBeNull();
  });

  it('keeps the macros that were filled in', () => {
    const changes = buildEntryChanges(form({ protein: '18', carbs: '40', fat: '9' }), {}, 150)!;
    expect(changes).toMatchObject({ protein_g: 18, carbs_g: 40, fat_g: 9 });
  });

  it('sends the weight so the next edit scales from a real portion', () => {
    expect(buildEntryChanges(form(), {}, 150)).toMatchObject({ quantity: 150, unit: 'g' });
  });

  it('omits a weight it could not work out — the API demands a positive one', () => {
    const changes = buildEntryChanges(form(), {}, 0)!;
    expect('quantity' in changes).toBe(false);
    expect('unit' in changes).toBe(false);
  });

  it('trims the name', () => {
    expect(buildEntryChanges(form({ name: '  Dal  ' }), {}, 150)!.food_name).toBe('Dal');
  });

  it('carries the meal, which the API will not accept as null', () => {
    expect(buildEntryChanges(form({ meal: 'dinner' }), {}, 150)!.meal_type).toBe('dinner');
  });

  it('refuses a nameless entry', () => {
    expect(buildEntryChanges(form({ name: '   ' }), {}, 150)).toBeNull();
  });

  it('refuses unparseable calories rather than sending NaN', () => {
    expect(buildEntryChanges(form({ calories: 'abc' }), {}, 150)).toBeNull();
  });

  it('refuses a blank calorie field instead of saving the entry as 0 kcal', () => {
    // `Number('')` is 0, not NaN — clearing the field used to look valid.
    expect(buildEntryChanges(form({ calories: '' }), {}, 150)).toBeNull();
    expect(buildEntryChanges(form({ calories: '  ' }), {}, 150)).toBeNull();
  });

  it('refuses negative calories', () => {
    expect(buildEntryChanges(form({ calories: '-50' }), {}, 150)).toBeNull();
  });

  it('still allows a genuine zero-calorie entry', () => {
    // Black coffee, water, sweetener — 0 typed on purpose is valid.
    expect(buildEntryChanges(form({ calories: '0' }), {}, 150)).toMatchObject({ calories: 0 });
  });

  it('produces a body with no nulls at all for a macro-less entry', () => {
    // The strongest form of the guarantee: nothing in this payload can trip
    // the server's number validation.
    const changes = buildEntryChanges(form(), {}, 150)!;
    expect(Object.values(changes).some((v) => v === null)).toBe(false);
  });
});

/** JSON.stringify drops undefined, which is exactly what the fetch body does. */
function stripUndefined(o: object): object {
  return JSON.parse(JSON.stringify(o));
}
