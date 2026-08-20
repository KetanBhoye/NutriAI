/**
 * A notice that the day's food log changed somewhere other than the screen
 * showing it.
 *
 * The tab navigator keeps every tab mounted, so Today held whatever it last
 * fetched: logging a meal by talking to the Coach updated the server and left
 * Today showing the old list until the user pulled to refresh or stepped a day
 * away and back. The tap-through ("✓ updated your log") hid it, because
 * arriving that way remounted nothing either.
 *
 * Same shape as `goalsBus`, deliberately — one more pattern for "something
 * changed under you" would be one too many. The date travels with the event so
 * a screen looking at Tuesday doesn't re-fetch because the Coach wrote to
 * Monday.
 */

type Listener = (date: string) => void;
const listeners = new Set<Listener>();

export function subscribeEntriesChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Call after any write to a day's entries that this screen didn't make itself. */
export function emitEntriesChanged(date: string): void {
  for (const l of listeners) l(date);
}
