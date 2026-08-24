import type { CoachTurn } from './agent.js';

/**
 * Making a coach turn safe to send twice.
 *
 * The app streams a turn over a long-lived request and falls back to the plain
 * endpoint if the stream breaks, on the assumption that a broken stream means
 * nothing was applied. That assumption is false in one very ordinary case:
 * backgrounding the app. Android kills the connection, but the server
 * deliberately keeps running the turn ("a client that has gone away must not
 * take the turn down with it"), so the entries are already written when the
 * retry arrives — and the agent writes them a second time. Users saw meals
 * logged twice after switching apps mid-reply.
 *
 * The turn is not idempotent and cannot be made so — it calls a model, which
 * is free to do something different the second time. So the fix is to not run
 * it twice: the client stamps each user message with an id, and a repeat of an
 * id either waits for the turn already running or replays the answer it gave.
 *
 * In memory, deliberately. This exists to absorb a retry that arrives seconds
 * after the original, which is the shape of the bug; persisting turns would
 * mean storing conversation history for every user against a failure mode that
 * lasts a minute. **It assumes one server process** — with more than one
 * instance a retry could land elsewhere and duplicate again, and this would
 * need to become a table.
 */

/** Long enough to cover a slow turn plus a retry; short enough to stay small. */
const TTL_MS = 15 * 60_000;

/** A ceiling so a burst of traffic cannot grow this without bound. */
const MAX_ENTRIES = 500;

interface Entry {
  at: number;
  /** Resolves with the turn's result; shared by every caller of the same id. */
  promise: Promise<CoachTurn>;
}

const turns = new Map<string, Entry>();

function sweep(now: number): void {
  for (const [key, entry] of turns) {
    if (now - entry.at > TTL_MS) turns.delete(key);
  }
  // If it is still too big, drop the oldest — insertion order is age order.
  while (turns.size > MAX_ENTRIES) {
    const oldest = turns.keys().next().value;
    if (oldest === undefined) break;
    turns.delete(oldest);
  }
}

/** Namespaced by user: one person's turn id must never return another's reply. */
function keyFor(userId: string, turnId: string): string {
  return `${userId}:${turnId}`;
}

export function cachedTurnCount(): number {
  return turns.size;
}

export function clearTurnCache(): void {
  turns.clear();
}

/**
 * Runs `work` once per (user, turn id).
 *
 * A second call with the same id while the first is still running awaits that
 * same turn rather than starting another — which is precisely the retry the
 * streaming client makes. A second call after it finished replays the answer.
 *
 * With no id, nothing is cached: an older client that doesn't send one behaves
 * exactly as it did before.
 */
export async function runOnce(
  userId: string,
  turnId: string | undefined,
  work: () => Promise<CoachTurn>
): Promise<CoachTurn> {
  if (!turnId) return work();

  const now = Date.now();
  sweep(now);

  const key = keyFor(userId, turnId);
  const existing = turns.get(key);
  if (existing) return existing.promise;

  const promise = work();
  turns.set(key, { at: now, promise });

  try {
    return await promise;
  } catch (error) {
    // A failed turn is not a turn that happened: forget it so the user can
    // legitimately try again. Only a *completed* turn must not repeat.
    turns.delete(key);
    throw error;
  }
}
