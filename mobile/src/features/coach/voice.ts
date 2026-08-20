import type {
  ExpoSpeechRecognitionErrorEvent,
  ExpoSpeechRecognitionResultEvent,
} from 'expo-speech-recognition';

/**
 * The microphone half of the Coach — dictation, wrapped so that a build
 * without the native module degrades to a text-only composer instead of a
 * white screen.
 *
 * `expo-speech-recognition` resolves its native module at *import* time, and
 * throws when it isn't linked. That is exactly the state of any dev client
 * built before this feature landed, and of an APK a user hasn't updated yet —
 * so the import is a lazy `require` behind a try/catch, and every function
 * here is a no-op when it failed. `isDictationAvailable()` is what the UI
 * asks before drawing the mic at all.
 *
 * Recognition is on-device where the OS offers it (iOS Speech framework,
 * Android's recognition service). No audio is recorded to disk and none of it
 * reaches NutriAI's server: only the transcript is sent, as if it had been
 * typed.
 */

type SpeechModule = typeof import('expo-speech-recognition');

/** `undefined` = not tried yet, `null` = tried and the module isn't there. */
let cached: SpeechModule | null | undefined;

function speechModule(): SpeechModule | null {
  if (cached === undefined) {
    try {
      cached = require('expo-speech-recognition') as SpeechModule;
    } catch (error) {
      console.warn('[coach] speech recognition unavailable:', error);
      cached = null;
    }
  }
  return cached;
}

export function isDictationAvailable(): boolean {
  const mod = speechModule();
  if (!mod) return false;
  try {
    return mod.isRecognitionAvailable();
  } catch {
    // A phone with no recognition service at all (some Android ROMs ship
    // without the Google app) — same outcome for us as a missing module.
    return false;
  }
}

/** True once the mic *and* (on iOS) speech recognition are both granted. */
export async function requestDictationPermission(): Promise<boolean> {
  const mod = speechModule();
  if (!mod) return false;
  try {
    const current = await mod.ExpoSpeechRecognitionModule.getPermissionsAsync();
    if (current.granted) return true;
    const asked = await mod.ExpoSpeechRecognitionModule.requestPermissionsAsync();
    return asked.granted;
  } catch {
    return false;
  }
}

/**
 * `contextualStrings` biases the recogniser towards the vocabulary this app is
 * actually dictated in. Without it "dal" comes back as "doll" and "paneer" as
 * "pioneer" — the words a food log is made of are exactly the ones a general
 * language model ranks lowest.
 */
const FOOD_HINTS = [
  'roti',
  'chapati',
  'dal',
  'paneer',
  'sabzi',
  'idli',
  'dosa',
  'poha',
  'rajma',
  'chana',
  'ghee',
  'curd',
  'protein',
  'calories',
  'kcal',
  'grams',
  'breakfast',
  'lunch',
  'dinner',
  'snack',
];

/** False when the native call failed, so the caller doesn't sit in a fake listening state. */
export function startDictation(): boolean {
  const mod = speechModule();
  if (!mod) return false;
  try {
    mod.ExpoSpeechRecognitionModule.start({
      lang: 'en-IN',
      // The composer fills in as you speak; without interim results the field
      // stays empty for the whole sentence and the mic looks broken.
      interimResults: true,
      // Long enough to describe a full meal without the recogniser calling time
      // mid-sentence. On Android 12 and below this is ignored by the OS.
      continuous: true,
      addsPunctuation: true,
      contextualStrings: FOOD_HINTS,
      volumeChangeEventOptions: { enabled: true, intervalMillis: 150 },
    });
    return true;
  } catch (error) {
    console.warn('[coach] could not start dictation:', error);
    return false;
  }
}

/** Asks for a final transcript. Use for "I'm done talking". */
export function stopDictation(): void {
  try {
    speechModule()?.ExpoSpeechRecognitionModule.stop();
  } catch (error) {
    console.warn('[coach] could not stop dictation:', error);
  }
}

/** Throws the turn away. Use when the user cancels or leaves the screen. */
export function abortDictation(): void {
  try {
    speechModule()?.ExpoSpeechRecognitionModule.abort();
  } catch (error) {
    console.warn('[coach] could not abort dictation:', error);
  }
}

export type DictationHandlers = {
  onResult: (event: ExpoSpeechRecognitionResultEvent) => void;
  onError: (event: ExpoSpeechRecognitionErrorEvent) => void;
  onEnd: () => void;
  onVolume: (level: number) => void;
};

/**
 * Subscribes to a dictation session; returns an unsubscribe for all of them.
 *
 * Takes the module as an argument rather than reaching for it, so the wiring
 * below can be tested without a device — see voice.test.ts, which exists
 * because of the bug in the next paragraph.
 *
 * **Always through `ExpoSpeechRecognitionModule.addListener`.** The package
 * also exports `addSpeechRecognitionListener`, which is a bare reference to
 * that same method:
 *
 *     export const addSpeechRecognitionListener = ExpoSpeechRecognitionModule.addListener;
 *
 * Called off the exports object, `this` is the module namespace instead of the
 * native module, and the subscription silently attaches to nothing. Every
 * event then goes missing at once — no transcript, no volume, and no `end`,
 * which is the one that ends the session in the UI. The mic appeared to work
 * and the stop button appeared dead.
 */
export function attachListeners(mod: SpeechModule, handlers: DictationHandlers): () => void {
  const emitter = mod.ExpoSpeechRecognitionModule;
  const subs = [
    emitter.addListener('result', handlers.onResult),
    emitter.addListener('error', handlers.onError),
    emitter.addListener('end', handlers.onEnd),
    emitter.addListener('volumechange', (e) => handlers.onVolume(e.value)),
  ];
  return () => {
    for (const sub of subs) sub.remove();
  };
}

export function listenToDictation(handlers: DictationHandlers): () => void {
  const mod = speechModule();
  if (!mod) return () => {};
  try {
    return attachListeners(mod, handlers);
  } catch (error) {
    console.warn('[coach] could not subscribe to dictation events:', error);
    return () => {};
  }
}

/**
 * Why the mic stopped, in words the user can act on. The raw codes are for
 * logs — "service-not-allowed" tells nobody to open Settings.
 */
export function dictationErrorMessage(code: string): string | null {
  switch (code) {
    // Not failures: the user stopped, or simply didn't speak.
    case 'aborted':
    case 'no-speech':
    case 'speech-timeout':
      return null;
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access is off. Enable it for NutriAI in Settings.';
    case 'network':
      return "Speech recognition needs a connection and couldn't reach it.";
    case 'language-not-supported':
      return "This phone can't transcribe English yet — type instead.";
    case 'busy':
      return 'The recogniser is busy. Try again in a second.';
    default:
      return "Couldn't hear that. Try again, or type it.";
  }
}
