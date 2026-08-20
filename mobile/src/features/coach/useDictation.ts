import { useCallback, useEffect, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
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

/**
 * One dictation session, as state.
 *
 * `onFinal` fires once per session with the finished transcript, so hands-free
 * mode can send it. It is deliberately *not* fired for interim results: those
 * change under you mid-sentence, and a message sent from one would be half a
 * thought.
 */
export function useDictation(onFinal?: (text: string) => void): Dictation {
  const [available] = useState(() => isDictationAvailable());
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  /** Read by the stop watchdog, which runs outside the render that set it. */
  const transcriptRef = useRef('');
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Read inside the native callbacks, which are registered once and would
  // otherwise close over the first render's values.
  const finalText = useRef('');
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  /**
   * Fallback for a `stop()` the recogniser never answers.
   *
   * Everything here hangs off the native `end` event, so a session that stops
   * without emitting one leaves the composer stuck on "Listening…" — with the
   * text field disabled, which takes typing away too. That is unrecoverable
   * without killing the app, so it gets a timeout rather than trust.
   */
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearStopTimer = () => {
    if (stopTimer.current) {
      clearTimeout(stopTimer.current);
      stopTimer.current = null;
    }
  };

  useEffect(() => {
    if (!available) return;
    return listenToDictation({
      onResult: (event) => {
        const text = event.results?.[0]?.transcript ?? '';
        transcriptRef.current = text;
        setTranscript(text);
        if (event.isFinal) finalText.current = text;
      },
      onError: (event) => {
        clearStopTimer();
        const message = dictationErrorMessage(event.error);
        if (message) setError(message);
        setListening(false);
        setLevel(0);
      },
      onEnd: () => {
        clearStopTimer();
        setListening(false);
        setLevel(0);
        const text = finalText.current.trim();
        finalText.current = '';
        if (text) onFinalRef.current?.(text);
      },
      // -2…10 from the OS, where anything under 0 is silence. Squashed to 0–1
      // and eased, so a quiet room doesn't leave the meter twitching.
      onVolume: (value) => setLevel(Math.max(0, Math.min(1, value / 8))),
    });
  }, [available]);

  // Never leave the mic hot behind a screen the user has left.
  useEffect(
    () => () => {
      clearStopTimer();
      abortDictation();
    },
    []
  );

  const start = useCallback(async () => {
    if (!available || listening) return;
    setError(null);
    const granted = await requestDictationPermission();
    if (!granted) {
      setError('NutriAI needs microphone access to hear you. Enable it in Settings.');
      return;
    }
    finalText.current = '';
    transcriptRef.current = '';
    setTranscript('');
    // Only claim to be listening once the native call has actually accepted:
    // a throw here used to leave the UI in a session that didn't exist.
    if (!startDictation()) {
      setError("The microphone couldn't start. Try again, or type it.");
      return;
    }
    setListening(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [available, listening]);

  const stop = useCallback(() => {
    if (!listening) return;
    void Haptics.selectionAsync();
    // The `end` event does the state clean-up — clearing it here as well would
    // hide the last interim words while the final result is still coming.
    stopDictation();

    // …but only if it arrives. Four seconds is well past a normal finalisation
    // and still short enough that a user who tapped stop doesn't conclude the
    // app is broken. Whatever was heard by then is kept, not thrown away.
    clearStopTimer();
    stopTimer.current = setTimeout(() => {
      stopTimer.current = null;
      setListening(false);
      setLevel(0);
      const text = finalText.current.trim() || transcriptRef.current.trim();
      finalText.current = '';
      if (text) onFinalRef.current?.(text);
    }, 4000);
  }, [listening]);

  const cancel = useCallback(() => {
    clearStopTimer();
    finalText.current = '';
    transcriptRef.current = '';
    setTranscript('');
    setListening(false);
    setLevel(0);
    abortDictation();
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { available, listening, transcript, level, error, start, stop, cancel, clearError };
}
