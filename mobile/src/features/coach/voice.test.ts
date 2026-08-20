import { describe, expect, it } from 'vitest';
import { dictationErrorMessage } from './voice';

describe('dictationErrorMessage', () => {
  it('says nothing when the user simply stopped or stayed quiet', () => {
    expect(dictationErrorMessage('aborted')).toBeNull();
    expect(dictationErrorMessage('no-speech')).toBeNull();
    expect(dictationErrorMessage('speech-timeout')).toBeNull();
  });

  it('points a denied microphone at Settings', () => {
    expect(dictationErrorMessage('not-allowed')).toMatch(/Settings/);
    expect(dictationErrorMessage('service-not-allowed')).toMatch(/Settings/);
  });

  it('falls back to a usable sentence for an unknown code', () => {
    expect(dictationErrorMessage('wat')).toMatch(/type it/);
  });
});
