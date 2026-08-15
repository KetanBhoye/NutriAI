/**
 * What the Coach is doing, in words, while it does it.
 *
 * A coach turn takes 30–60 seconds when it logs food: the agent asks the model
 * what to do, calls a web-grounded nutrition lookup, then writes each entry.
 * Until now the whole of that was one spinner, which reads as "broken" long
 * before it is.
 *
 * These labels are driven by the tool calls the server actually makes, streamed
 * as they happen — not a timer cycling through plausible-sounding stages. That
 * distinction matters: a fake progress indicator that says "Logging your food"
 * while the request is failing is worse than a spinner, because it is a lie the
 * user can act on.
 */

/**
 * Present tense, no ellipsis (the UI adds one), and phrased as the thing the
 * *user* cares about rather than the tool's name. A user does not know what
 * `compare_progress` is; they know they asked how they were doing.
 */
const LABELS: Record<string, string> = {
  lookup_nutrition: 'Looking up the nutrition',
  add_entry: 'Adding it to your log',
  update_entry: 'Updating your entry',
  delete_entry: 'Removing that entry',
  list_entries: 'Reading your day',
  get_user_preferences: 'Checking your targets',
  set_user_preferences: 'Saving your preferences',
  get_profile: 'Checking your profile',
  update_profile: 'Updating your profile',
  get_profile_history: 'Looking back through your weigh-ins',
  add_body_measurement: 'Recording your measurements',
  list_body_measurements: 'Reading your measurements',
  compare_progress: 'Comparing your progress',
  list_progress_photos: 'Finding your photos',
};

/** The wording before the first tool call, and after the last one. */
export const THINKING_LABEL = 'Thinking';

/**
 * One line for a step, however many tools it ran.
 *
 * The model can call several tools in a single step — three `add_entry` calls
 * for a three-item meal is the normal case. Listing them all would flicker, so
 * a repeated tool is named once and counted, and genuinely different tools are
 * joined. An unknown name falls back to the generic label rather than leaking
 * an identifier like `set_user_preferences` into the UI.
 */
export function describeStep(tools: string[]): string {
  const named = tools.filter((t) => typeof t === 'string' && t.length > 0);
  if (named.length === 0) return THINKING_LABEL;

  const unique: string[] = [];
  for (const tool of named) if (!unique.includes(tool)) unique.push(tool);

  const parts = unique.map((tool) => {
    const label = LABELS[tool] ?? THINKING_LABEL;
    const count = named.filter((t) => t === tool).length;
    return count > 1 ? `${label} (${count})` : label;
  });

  // Two is the most that stays readable in a chat bubble.
  return parts.slice(0, 2).join(' · ');
}
