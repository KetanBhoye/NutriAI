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
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Read inside the native callbacks, which are registered once and would
  // otherwise close over the first render's values.
  const finalText = useRef('');
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  useEffect(() => {
    if (!available) return;
    return listenToDictation({
      onResult: (event) => {
        const text = event.results?.[0]?.transcript ?? '';
        setTranscript(text);
        if (event.isFinal) finalText.current = text;
      },
      onError: (event) => {
        const message = dictationErrorMessage(event.error);
        if (message) setError(message);
        setListening(false);
        setLevel(0);
      },
      onEnd: () => {
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
  useEffect(() => () => abortDictation(), []);

  const start = useCallback(async () => {
    if (!available || listening) return;
    setError(null);
    const granted = await requestDictationPermission();
    if (!granted) {
      setError('NutriAI needs microphone access to hear you. Enable it in Settings.');
      return;
    }
    finalText.current = '';
    setTranscript('');
    setListening(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    startDictation();
  }, [available, listening]);

  const stop = useCallback(() => {
    if (!listening) return;
    void Haptics.selectionAsync();
    // The `end` event does the state clean-up — stopping here as well would
    // hide the last interim words while the final result is still coming.
    stopDictation();
  }, [listening]);

  const cancel = useCallback(() => {
    finalText.current = '';
    setTranscript('');
    setListening(false);
    setLevel(0);
    abortDictation();
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { available, listening, transcript, level, error, start, stop, cancel, clearError };
}
