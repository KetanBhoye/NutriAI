import { describe, expect, it, vi } from 'vitest';
import { emitGoalsChanged, subscribeGoalsChanged } from './goalsBus';

/**
 * The bus exists because the tab navigator keeps every tab mounted: a screen
 * that read the targets once would show them for the rest of the session.
 */

describe('goalsBus', () => {
  it('tells every subscriber', () => {
    const today = vi.fn();
    const trends = vi.fn();
    const unsubA = subscribeGoalsChanged(today);
    const unsubB = subscribeGoalsChanged(trends);

    emitGoalsChanged();

    expect(today).toHaveBeenCalledTimes(1);
    expect(trends).toHaveBeenCalledTimes(1);
    unsubA();
    unsubB();
  });

  it('stops telling a screen that has unmounted', () => {
    const listener = vi.fn();
    const unsub = subscribeGoalsChanged(listener);
    unsub();

    emitGoalsChanged();

    expect(listener).not.toHaveBeenCalled();
  });

  it('does not fire on subscribe — only on a real change', () => {
    // Screens load their own data on mount; a replayed event would double-fetch.
    const listener = vi.fn();
    const unsub = subscribeGoalsChanged(listener);
    expect(listener).not.toHaveBeenCalled();
    unsub();
  });

  it('fires again on every subsequent change', () => {
    const listener = vi.fn();
    const unsub = subscribeGoalsChanged(listener);

    emitGoalsChanged();
    emitGoalsChanged();

    expect(listener).toHaveBeenCalledTimes(2);
    unsub();
  });

  it('is safe with no subscribers at all', () => {
    expect(() => emitGoalsChanged()).not.toThrow();
  });

  it('unsubscribing twice is harmless', () => {
    const unsub = subscribeGoalsChanged(vi.fn());
    unsub();
    expect(() => unsub()).not.toThrow();
  });
});
