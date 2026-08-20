/**
 * Folding a stream of recogniser results into one piece of text.
 *
 * The two platforms disagree about what a "result" contains, and neither
 * contract is a superset of the other:
 *
 * - **iOS** hands back the *cumulative* transcript for the session every time.
 *   "What" → "What are" → "What are you doing?". Appending each one produces
 *   "What What are What are you doing?" — and because iOS 18 detects
 *   final-like results by speech duration, the same final arrives repeatedly,
 *   which is what flooded the composer with ten copies of one sentence.
 * - **Android 13+** in continuous mode emits `onSegmentResults` per segment,
 *   each carrying only that segment. Replacing on each one silently drops
 *   everything said before the last pause.
 *
 * So neither "append" nor "replace" is right, and which one applies can't be
 * decided per platform either — a phone with a different recognition service
 * behaves like whichever it feels like. This decides per *result*, from the
 * text itself, which is the only evidence that is actually reliable.
 */

/** Collapses runs of whitespace; recognisers pad segments unpredictably. */
function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Punctuation-insensitive comparison key.
 *
 * `addsPunctuation` means the same words can come back as "what are you
 * doing" and then "What are you doing?" — the same speech, twice, which must
 * not read as two segments.
 */
function key(text: string): string {
  return tidy(text)
    .toLowerCase()
    .replace(/[.,!?;:]/g, '');
}

/**
 * Merges one result into what the session has so far.
 *
 * The rules, in order:
 *  1. Nothing new to add → unchanged.
 *  2. The new text continues what we have (iOS's growing transcript) → it
 *     replaces it, because it already contains it.
 *  3. We already end with the new text (the same final delivered again) →
 *     unchanged. This is the flooding guard.
 *  4. Otherwise it's a new segment (Android) → appended.
 */
export function mergeTranscript(committed: string, incoming: string): string {
  const base = tidy(committed);
  const next = tidy(incoming);
  if (!next) return base;
  if (!base) return next;

  const baseKey = key(base);
  const nextKey = key(next);

  // Rule 2 — the recogniser re-sent everything, with more on the end.
  if (nextKey.startsWith(baseKey)) return next;
  // Rule 3 — a repeat of what we already hold, whole or trailing.
  if (baseKey === nextKey || baseKey.endsWith(nextKey)) return base;

  return `${base} ${next}`;
}

/**
 * The composer's text: what was typed, plus what is being said.
 *
 * A plain join, not a merge — typed words are deliberate, so nothing here
 * second-guesses them. It exists so the live preview and the text finally
 * committed to the composer are produced by the same line of code; when they
 * were computed in two places, dictating after typing put the space in one and
 * not the other.
 */
export function joinDraft(typed: string, spoken: string): string {
  return [tidy(typed), tidy(spoken)].filter(Boolean).join(' ');
}
