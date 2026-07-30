import { Goal, Macros, computeMacros } from '@/nutrition';

/**
 * What the Plan editor's choices imply — or null while they're incomplete.
 *
 * Extracted from the screen because this is the rule that has now broken a
 * user's saved plan twice: the editor may only produce targets once the user
 * has actually chosen, and a null here is what stops every downstream effect
 * (the recompute, the AI refine button, Save on a first plan) from running off
 * values nobody picked.
 */
export function editorTargets(
  tdee: number | null,
  weightKg: number,
  goal: Goal | null,
  rateKgPerWeek: number | null
): Macros | null {
  // No activity level chosen yet, so there is no maintenance figure to work from.
  if (tdee === null || !goal) return null;
  // Every goal but "maintain" needs a pace before it means anything.
  if (goal !== 'maintain' && rateKgPerWeek === null) return null;
  return computeMacros(tdee, weightKg, goal, rateKgPerWeek ?? 0);
}
