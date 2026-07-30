/**
 * A one-line notice that the user's plan / daily targets changed.
 *
 * The tab navigator keeps every tab mounted, so Today, Trends and You each
 * loaded their goals once and then kept showing them for the rest of the
 * session — editing the plan only appeared to work on the Plan tab. Screens
 * subscribe here and re-read after a save, so one edit lands everywhere.
 */

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeGoalsChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Call after any successful write to the plan or the macro targets. */
export function emitGoalsChanged(): void {
  for (const l of listeners) l();
}
