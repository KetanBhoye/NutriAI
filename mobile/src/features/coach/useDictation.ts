import { useCallback, useEffect, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import {
  idleSession,
  reduceSession,
  sessionText,
  type SessionEvent,
  type SessionState,
} from './dictationSession';
import {
  abortDictation,
  dictationErrorMessage,
  isDictationAvailable,
  listenToDictation,
  requestDictationPermission,
  startDictation,
  stopDictation,
} from './voice';

export interface Dictation {
  /** False on a build without the native module, or a phone with no recogniser. */
  available: boolean;
  listening: boolean;
  /** What has been heard so far this session, interim results included. */
  transcript: string;
  /** 0–1, for the level meter. Smoothed; raw values jitter every 150ms. */
  level: number;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
  clearError: () => void;
}

/** How long to wait for the `end` event that `stop()` is supposed to produce. */
const STOP_GRACE_MS = 4000;

/**
 * One dictation session, as state.
 *
 * All the sequencing lives in `dictationSession.ts`, where it is under test —
 * this only wires native events to it and native calls to the UI. `onFinal`
 * fires **once per session**, with everything that was heard.
 *
 * It is deliberately not fired for interim results: those change under you
 * mid-sentence, and in hands-free mode a message sent from one would be half a
 * thought.
 */
export function useDictation(onFinal?: (text: string) => void): Dictation {
  const [available] = useState(() => isDictationAvailable());
  const [session, setSession] = useState<SessionState>(idleSession);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // The native callbacks are registered once, so everything they touch is a
  // ref — a closure over the first render's state would be permanently stale.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  /**
   * Fallback for a `stop()` the recogniser never answers.
   *
   * Everything here hangs off the native `end` event, so a session that stops
   * without emitting one leaves the composer on "Listening…" with the text
   * field disabled — which takes typing away too, and can only be cleared by
   * killing the app. It gets a timeout rather than trust.
   */
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearStopTimer = useCallback(() => {
    if (stopTimer.current) {
      clearTimeout(stopTimer.current);
      stopTimer.current = null;
    }
  }, []);

  /** The single path by which anything reaches the session state. */
  const dispatch = useCallback(
    (event: SessionEvent) => {
      const { state, emit } = reduceSession(sessionRef.current, event);
      sessionRef.current = state;
      setSession(state);
      if (!state.active) {
        clearStopTimer();
        setLevel(0);
      }
      if (emit) onFinalRef.current?.(emit);
    },
    [clearStopTimer]
  );

  useEffect(() => {
    if (!available) return;
    return listenToDictation({
      onResult: (event) =>
        dispatch({
          type: 'result',
          text: event.results?.[0]?.transcript ?? '',
          isFinal: event.isFinal,
        }),
      onError: (event) => {
        const message = dictationErrorMessage(event.error);
        if (message) setError(message);
        dispatch({ type: 'error' });
      },
      onEnd: () => dispatch({ type: 'end' }),
      // -2…10 from the OS, where anything under 0 is silence. Squashed to 0–1
      // so a quiet room doesn't leave the meter twitching.
      onVolume: (value) => setLevel(Math.max(0, Math.min(1, value / 8))),
    });
  }, [available, dispatch]);

  // Never leave the mic hot behind a screen the user has left.
  useEffect(
    () => () => {
      clearStopTimer();
      abortDictation();
    },
    [clearStopTimer]
  );

  const start = useCallback(async () => {
    if (!available || sessionRef.current.active) return;
    setError(null);
    const granted = await requestDictationPermission();
    if (!granted) {
      setError('NutriAI needs microphone access to hear you. Enable it in Settings.');
      return;
    }
    // Only claim to be listening once the native call has actually accepted:
    // a throw here used to leave the UI in a session that didn't exist.
    if (!startDictation()) {
      setError("The microphone couldn't start. Try again, or type it.");
      return;
    }
    dispatch({ type: 'start' });
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [available, dispatch]);

  const stop = useCallback(() => {
    if (!sessionRef.current.active) return;
    void Haptics.selectionAsync();
    // The `end` event does the finishing — doing it here as well would cut off
    // the last words while the final result is still on its way.
    stopDictation();

    // …but only if it arrives. Four seconds is well past a normal finalisation
    // and still short enough that a user who tapped stop doesn't conclude the
    // app is broken. Whatever was heard by then is kept, not thrown away.
    clearStopTimer();
    stopTimer.current = setTimeout(() => {
      stopTimer.current = null;
      dispatch({ type: 'timeout' });
    }, STOP_GRACE_MS);
  }, [clearStopTimer, dispatch]);

  const cancel = useCallback(() => {
    clearStopTimer();
    dispatch({ type: 'cancel' });
    abortDictation();
  }, [clearStopTimer, dispatch]);

  const clearError = useCallback(() => setError(null), []);

  return {
    available,
    listening: session.active,
    transcript: sessionText(session),
    level,
    error,
    start,
    stop,
    cancel,
    clearError,
  };
}
