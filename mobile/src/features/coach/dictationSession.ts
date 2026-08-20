import { mergeTranscript } from './transcript';

/**
 * One dictation session, as a pure state machine.
 *
 * The lifecycle is driven entirely by native events whose ordering is not
 * guaranteed and differs by platform: iOS can deliver the same final result
 * several times, Android emits a final per segment without ending, and either
 * can end a session without warning — or, as we found, never end one at all.
 *
 * Every bug this feature has had lived in that sequencing, so it is a reducer
 * rather than a knot of handlers around `useState`: the interesting cases are
 * event *orders*, and a reducer lets a test write them down directly.
 *
 * The two invariants worth stating, because both were broken in shipped code:
 *   1. A session emits its text **at most once**. Two `end` events, or an end
 *      plus the stop watchdog, must not send the message twice.
 *   2. Events outside a session are ignored. A late result from a session that
 *      already ended must not reopen the mic or edit the composer.
 */

export interface SessionState {
  /** The mic is live: results are being accepted. */
  active: boolean;
  /** Finalised text so far this session. */
  committed: string;
  /** The current in-progress phrase, replaced as the recogniser revises it. */
  live: string;
  /** This session's text has already been handed over. */
  emitted: boolean;
}

export type SessionEvent =
  | { type: 'start' }
  | { type: 'result'; text: string; isFinal: boolean }
  /** The recogniser ended the session. */
  | { type: 'end' }
  /** `stop()` produced no `end` in time — finish with whatever we heard. */
  | { type: 'timeout' }
  | { type: 'error' }
  /** The user threw the session away. */
  | { type: 'cancel' };

export interface SessionResult {
  state: SessionState;
  /** Text to hand to the caller, present only on the one event that finishes a session. */
  emit?: string;
}

export const idleSession: SessionState = { active: false, committed: '', live: '', emitted: false };

/** Everything heard this session, finalised and in-progress alike. */
export function sessionText(state: SessionState): string {
  return mergeTranscript(state.committed, state.live);
}

function finish(state: SessionState): SessionResult {
  // Guard both ways: a session that never started has nothing to say, and one
  // that already spoke must not speak twice.
  if (!state.active || state.emitted) return { state: { ...state, active: false } };

  const text = sessionText(state).trim();
  return {
    state: { ...state, active: false, emitted: true },
    ...(text ? { emit: text } : {}),
  };
}

export function reduceSession(state: SessionState, event: SessionEvent): SessionResult {
  switch (event.type) {
    case 'start':
      return { state: { active: true, committed: '', live: '', emitted: false } };

    case 'result': {
      if (!state.active) return { state };
      if (event.isFinal) {
        return {
          state: { ...state, committed: mergeTranscript(state.committed, event.text), live: '' },
        };
      }
      return { state: { ...state, live: event.text } };
    }

    case 'end':
    case 'timeout':
      return finish(state);

    case 'error':
      // An error means there is no trustworthy transcript — a half-heard meal
      // is worse than none, so the session closes with nothing to say.
      return { state: { ...state, active: false, emitted: true } };

    case 'cancel':
      return { state: idleSession };

    default:
      return { state };
  }
}
