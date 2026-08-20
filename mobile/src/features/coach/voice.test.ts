import { describe, expect, it, vi } from 'vitest';
import { attachListeners, dictationErrorMessage } from './voice';

/**
 * A stand-in for the package's exports, shaped like the real thing: a native
 * module whose `addListener` needs `this`, plus the loose re-export that
 * doesn't carry one.
 */
function fakeModule() {
  const seen: Array<{ event: string; receiver: unknown }> = [];
  const ExpoSpeechRecognitionModule = {
    addListener(event: string, _listener: unknown) {
      // The real one is a native method — record what it was called on.
      seen.push({ event, receiver: this });
      return { remove: vi.fn() };
    },
  };
  return {
    seen,
    module: {
      ExpoSpeechRecognitionModule,
      // Exactly how the package exports it: unbound.
      addSpeechRecognitionListener: ExpoSpeechRecognitionModule.addListener,
    },
  };
}

const handlers = { onResult: vi.fn(), onError: vi.fn(), onEnd: vi.fn(), onVolume: vi.fn() };

describe('attachListeners', () => {
  it('subscribes on the native module, not the exports object', () => {
    const { seen, module } = fakeModule();

    attachListeners(module as never, handlers);

    // The bug this pins: called through the package's bare re-export, `this`
    // is the namespace, the subscription attaches to nothing, and every event
    // — including `end`, which stops the session — silently never arrives.
    expect(seen).not.toHaveLength(0);
    for (const call of seen) expect(call.receiver).toBe(module.ExpoSpeechRecognitionModule);
  });

  it('listens for the events the UI depends on', () => {
    const { seen, module } = fakeModule();

    attachListeners(module as never, handlers);

    expect(seen.map((c) => c.event).sort()).toEqual(['end', 'error', 'result', 'volumechange']);
  });

  it('removes every subscription when unsubscribed', () => {
    const removes: Array<() => void> = [];
    const ExpoSpeechRecognitionModule = {
      addListener: () => {
        const remove = vi.fn();
        removes.push(remove);
        return { remove };
      },
    };

    attachListeners({ ExpoSpeechRecognitionModule } as never, handlers)();

    expect(removes).toHaveLength(4);
    for (const remove of removes) expect(remove).toHaveBeenCalled();
  });
});

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
