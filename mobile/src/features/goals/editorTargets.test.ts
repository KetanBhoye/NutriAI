import { describe, expect, it } from 'vitest';
import { editorTargets } from './editorTargets';
import { computeMacros } from '@/nutrition';

/**
 * The Plan editor may not produce targets until the user has actually chosen.
 * Twice now, pre-selected controls have recalculated on open and overwritten a
 * saved plan; a null from here is what stops that.
 */

describe('editorTargets', () => {
  it('is null before anything is chosen', () => {
    expect(editorTargets(null, 70, null, null)).toBeNull();
  });

  it('is null with a goal but no activity level, so there is no maintenance figure', () => {
    expect(editorTargets(null, 70, 'cut', 0.5)).toBeNull();
  });

  it('is null with an activity level but no goal', () => {
    expect(editorTargets(2400, 70, null, null)).toBeNull();
  });

  it('is null with a goal chosen but no pace yet', () => {
    // Tapping "Cut" must not move anyone's calories on its own.
    expect(editorTargets(2400, 70, 'cut', null)).toBeNull();
  });

  it('produces targets once activity, goal and pace are all chosen', () => {
    const targets = editorTargets(2400, 70, 'cut', 0.5);
    expect(targets).toEqual(computeMacros(2400, 70, 'cut', 0.5));
  });

  it('needs no pace for maintain, which has none to pick', () => {
    const targets = editorTargets(2400, 70, 'maintain', null);
    expect(targets).toEqual(computeMacros(2400, 70, 'maintain'));
    expect(targets!.calories).toBe(2400);
  });

  it('reflects a changed pace', () => {
    const gentle = editorTargets(2400, 70, 'cut', 0.5)!;
    const aggressive = editorTargets(2400, 70, 'cut', 1)!;
    expect(aggressive.calories).toBeLessThan(gentle.calories);
  });

  it('reflects a changed weight, since protein scales with it', () => {
    const lighter = editorTargets(2400, 60, 'cut', 0.5)!;
    const heavier = editorTargets(2400, 90, 'cut', 0.5)!;
    expect(heavier.protein_g).toBeGreaterThan(lighter.protein_g);
  });

  it('stays null for every incomplete combination', () => {
    const partials: Array<Parameters<typeof editorTargets>> = [
      [null, 70, null, null],
      [null, 70, 'cut', null],
      [null, 70, 'maintain', null],
      [2400, 70, null, 0.5],
      [2400, 70, 'cut', null],
      [2400, 70, 'lean_bulk', null],
    ];
    for (const args of partials) {
      expect(editorTargets(...args)).toBeNull();
    }
  });
});
