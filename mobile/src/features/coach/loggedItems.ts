import { FoodEntry, MealType, Totals } from '@/types';
import { sumTotals } from '@/meals';

/**
 * What a coach turn actually did to the day's log.
 *
 * The server tells us only *which* tools ran (`actions: ['add_entry', ...]`),
 * never what they wrote — so "✓ updated your log" was the most the chat could
 * honestly say, and the user had to leave the conversation to find out whether
 * the coach had understood "2 rotis and a bowl of dal" the way they meant.
 *
 * Rather than widen the API, the app re-reads the day either side of the turn
 * and diffs by entry id. That has a property the server response wouldn't: it
 * reflects what is *stored*, so a partially-applied turn (three items asked
 * for, two written) shows two — the card can't disagree with the Today tab.
 */

export interface LoggedItem {
  id: string;
  name: string;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  meal_type: MealType | null;
  quantity: number | null;
  unit: string | null;
}

export interface LogDiff {
  added: LoggedItem[];
  updated: LoggedItem[];
  removed: LoggedItem[];
  /** Net change to the day: what this turn did to the numbers on Today. */
  delta: Totals;
  /** The day's totals after the turn — what the Today tab now shows. */
  dayTotals: Totals;
}

function toItem(entry: FoodEntry): LoggedItem {
  return {
    id: entry.id,
    name: entry.food_name,
    calories: entry.calories,
    protein_g: entry.protein_g,
    carbs_g: entry.carbs_g,
    fat_g: entry.fat_g,
    meal_type: entry.meal_type,
    quantity: entry.quantity,
    unit: entry.unit,
  };
}

/** The fields a user would call "a change" — an `updated_at` bump alone isn't one. */
function differs(a: FoodEntry, b: FoodEntry): boolean {
  return (
    a.food_name !== b.food_name ||
    a.calories !== b.calories ||
    (a.protein_g ?? null) !== (b.protein_g ?? null) ||
    (a.carbs_g ?? null) !== (b.carbs_g ?? null) ||
    (a.fat_g ?? null) !== (b.fat_g ?? null) ||
    a.meal_type !== b.meal_type ||
    (a.quantity ?? null) !== (b.quantity ?? null)
  );
}

function subtract(a: Totals, b: Totals): Totals {
  return {
    calories: a.calories - b.calories,
    protein_g: a.protein_g - b.protein_g,
    carbs_g: a.carbs_g - b.carbs_g,
    fat_g: a.fat_g - b.fat_g,
  };
}

/**
 * Returns null when nothing about the day changed.
 *
 * Null rather than an empty diff on purpose: the caller then falls back to the
 * plain "updated your log" line instead of rendering a card that lists nothing,
 * which is what a read-only turn or a failed write would otherwise produce.
 */
export function diffEntries(before: FoodEntry[], after: FoodEntry[]): LogDiff | null {
  const beforeById = new Map(before.map((e) => [e.id, e]));
  const afterById = new Map(after.map((e) => [e.id, e]));

  const added: LoggedItem[] = [];
  const updated: LoggedItem[] = [];
  const removed: LoggedItem[] = [];

  for (const entry of after) {
    const previous = beforeById.get(entry.id);
    if (!previous) added.push(toItem(entry));
    else if (differs(previous, entry)) updated.push(toItem(entry));
  }
  for (const entry of before) if (!afterById.has(entry.id)) removed.push(toItem(entry));

  if (added.length === 0 && updated.length === 0 && removed.length === 0) return null;

  const dayTotals = sumTotals(after);
  return { added, updated, removed, delta: subtract(dayTotals, sumTotals(before)), dayTotals };
}

/** Same shape from a single read, for when we never got a "before" to compare. */
export function additionsOnly(entries: FoodEntry[], addedIds: string[]): LogDiff | null {
  const ids = new Set(addedIds);
  const added = entries.filter((e) => ids.has(e.id));
  if (added.length === 0) return null;
  const dayTotals = sumTotals(entries);
  return { added: added.map(toItem), updated: [], removed: [], delta: sumTotals(added), dayTotals };
}

/**
 * The card's one-line summary, e.g. "3 items logged · 620 kcal".
 *
 * Counts every kind of change so a turn that swapped one entry for another
 * doesn't read as "0 items". The calorie figure is the *net* change, signed,
 * because that's the number the user is tracking — a deletion showing "-180
 * kcal" is the point of deleting it.
 */
export function diffHeadline(diff: LogDiff): string {
  const parts: string[] = [];
  if (diff.added.length) parts.push(`${diff.added.length} added`);
  if (diff.updated.length) parts.push(`${diff.updated.length} updated`);
  if (diff.removed.length) parts.push(`${diff.removed.length} removed`);

  const kcal = Math.round(diff.delta.calories);
  const change = kcal === 0 ? null : `${kcal > 0 ? '+' : '−'}${Math.abs(kcal)} kcal`;
  return [parts.join(' · '), change].filter(Boolean).join(' · ');
}
