import { describe, expect, it, vi } from 'vitest';
import { emitEntriesChanged, subscribeEntriesChanged } from './entriesBus';

describe('entriesBus', () => {
  it('passes the date on to every subscriber', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeEntriesChanged(a);
    const offB = subscribeEntriesChanged(b);

    emitEntriesChanged('2026-08-20');

    expect(a).toHaveBeenCalledWith('2026-08-20');
    expect(b).toHaveBeenCalledWith('2026-08-20');
    offA();
    offB();
  });

  it('stops calling a subscriber that unsubscribed', () => {
    const listener = vi.fn();
    subscribeEntriesChanged(listener)();

    emitEntriesChanged('2026-08-20');

    expect(listener).not.toHaveBeenCalled();
  });
});
