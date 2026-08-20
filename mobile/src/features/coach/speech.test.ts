import { describe, expect, it } from 'vitest';
import { stripForSpeech } from './speech';

// No mock for expo-speech: the module only reaches for it inside `speak()`,
// which is exactly what lets an old build keep the Coach tab.

describe('stripForSpeech', () => {
  it('drops emoji rather than letting them be read out', () => {
    expect(stripForSpeech('Nice work 🥗🔥')).toBe('Nice work');
  });

  it('drops the tick the log line starts with', () => {
    expect(stripForSpeech('✓ updated your log')).toBe('updated your log');
  });

  it('keeps the words inside markdown emphasis', () => {
    expect(stripForSpeech('You have **42g** of protein left')).toBe('You have 42g of protein left');
  });

  it('turns a bulleted list into sentences', () => {
    expect(stripForSpeech('Logged:\n- Dal, 180 kcal\n- Rice, 210 kcal')).toBe(
      'Logged. Dal, 180 kcal. Rice, 210 kcal'
    );
  });

  it('returns empty for text that was nothing but symbols', () => {
    expect(stripForSpeech('✓ 🔥')).toBe('');
  });
});
