/**
 * Reading the coach's replies out loud.
 *
 * Only used in hands-free mode and from the message menu — a reply that starts
 * talking on its own is startling, so speaking is always something the user
 * turned on or asked for.
 *
 * `expo-speech` resolves its native module at import time and throws when it
 * isn't linked — which is the state of every build made before this feature
 * landed. Required lazily, for the same reason as the recogniser in `voice.ts`:
 * an old binary should lose the audio, not the Coach tab.
 */

type SpeechModule = typeof import('expo-speech');

/** `undefined` = not tried yet, `null` = tried and the module isn't there. */
let cached: SpeechModule | null | undefined;

function speechModule(): SpeechModule | null {
  if (cached === undefined) {
    try {
      cached = require('expo-speech') as SpeechModule;
    } catch (error) {
      console.warn('[coach] text-to-speech unavailable:', error);
      cached = null;
    }
  }
  return cached;
}

/** False on a build without the native module — the UI hides "Read aloud". */
export function isSpeechAvailable(): boolean {
  return speechModule() !== null;
}

/**
 * Chat text contains things a synthesiser reads aloud badly: the "✓" the log
 * line starts with becomes "check mark", `**160g**` becomes "asterisk asterisk
 * one hundred and sixty gee", and a bulleted list is read as a run-on
 * sentence.
 *
 * Emoji are matched by surrogate-pair range rather than `\p{Extended_Pictographic}`:
 * Hermes' unicode property escape support is patchy, and a regex that throws at
 * parse time would take the whole screen down rather than just mispronouncing a
 * word.
 */
export function stripForSpeech(text: string): string {
  return (
    text
      // Emoji and other astral-plane symbols.
      .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
      // The BMP symbols the app itself uses: ✓ ✅ ★ ▸ • ‹ › ↑ →
      .replace(/[ -⁯←-⇿⌀-➿⬀-⯿️]/g, ' ')
      // Markdown emphasis and headings, keeping the words inside.
      .replace(/[*_`#]+/g, '')
      // A list becomes separate sentences, so it isn't read as one long line.
      .replace(/^\s*[-–]\s+/gm, '')
      // "Logged:" ending a line would otherwise become "Logged:." below.
      .replace(/[:;,]\s*\n/g, '\n')
      .replace(/\n+/g, '. ')
      .replace(/\s{2,}/g, ' ')
      .replace(/\.\s*\./g, '.')
      .trim()
  );
}

export function speak(text: string, onDone?: () => void): void {
  const mod = speechModule();
  const clean = stripForSpeech(text);
  if (!mod || !clean) {
    onDone?.();
    return;
  }
  mod.stop();
  mod.speak(clean, {
    // Slightly under the default: the coach quotes figures, and the stock rate
    // runs "one hundred and sixty grams of protein" together.
    rate: 0.96,
    onDone,
    onStopped: onDone,
    onError: onDone,
  });
}

export function stopSpeaking(): void {
  speechModule()?.stop();
}
