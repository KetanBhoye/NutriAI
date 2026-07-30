import { MealType } from '@/types';

/**
 * Builds the PATCH body for an edited entry.
 *
 * Extracted from `EntryDetailModal` because the rules here are exactly what
 * broke once already: the modal sent `null` for any macro left blank, and
 * `PATCH /api/entries/:id` validates each macro as a number, so one blank field
 * failed the whole update — including the calorie change the user had actually
 * made. The queue drops 4xx, so the edit vanished without a word. These rules
 * are worth a test rather than a comment.
 */

export interface EntryEditForm {
  name: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  meal: MealType;
}

/** The entry as stored, used to tell "left blank" from "cleared". */
export interface EntryOriginal {
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
}

export interface EntryChanges {
  food_name: string;
  calories: number;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  meal_type: MealType;
  quantity?: number;
  unit?: string;
}

/**
 * A filled field becomes a number. A blank one is sent as null — meaning
 * "clear it" — only when the entry had a value there to begin with; otherwise
 * it's left out entirely, so an entry logged without macros doesn't turn every
 * edit into a payload the API rejects.
 */
export function macroValue(text: string, original: number | null | undefined): number | null | undefined {
  if (text.trim()) {
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return original != null ? null : undefined;
}

/** Returns null when the form can't make a valid entry, so callers can bail. */
export function buildEntryChanges(
  form: EntryEditForm,
  original: EntryOriginal,
  grams: number
): EntryChanges | null {
  if (!form.name.trim()) return null;

  // `Number('')` is 0, not NaN, so a blank calorie field would otherwise sail
  // through this check and save the entry as 0 kcal.
  if (!form.calories.trim()) return null;
  const calories = Number(form.calories);
  if (!Number.isFinite(calories) || calories < 0) return null;

  return {
    food_name: form.name.trim(),
    calories: Math.round(calories),
    protein_g: macroValue(form.protein, original.protein_g),
    carbs_g: macroValue(form.carbs, original.carbs_g),
    fat_g: macroValue(form.fat, original.fat_g),
    meal_type: form.meal,
    // The weight travels with the macros so the next edit scales from the real
    // portion — but the API requires a positive quantity, so a weight we
    // couldn't work out is omitted rather than sent as 0.
    ...(grams > 0 ? { quantity: grams, unit: 'g' } : {}),
  };
}
