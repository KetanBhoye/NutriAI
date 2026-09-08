import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cachedTurnCount, clearTurnCache, runOnce } from './turn-cache.js';
import type { CoachTurn } from './agent.js';

const turn = (reply: string): CoachTurn => ({ reply, actions: ['add_entry'], history: [], sources: [] });

beforeEach(() => clearTurnCache());

describe('runOnce', () => {
  it('runs the turn and returns its answer', async () => {
    const work = vi.fn(async () => turn('logged'));

    expect(await runOnce('u1', 'turn-abc123', work)).toEqual(turn('logged'));
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('does not run a repeated id a second time — the duplicate-entry bug', async () => {
    // The exact shape of it: the app is backgrounded, the stream dies, and the
    // client re-sends while the first turn is still writing entries.
    let release: (value: CoachTurn) => void = () => {};
    const work = vi.fn(
      () =>
        new Promise<CoachTurn>((resolve) => {
          release = resolve;
        })
    );

    const first = runOnce('u1', 'turn-abc123', work);
    const retry = runOnce('u1', 'turn-abc123', work);
    release(turn('logged 2 rotis'));

    expect(await first).toEqual(turn('logged 2 rotis'));
    expect(await retry).toEqual(turn('logged 2 rotis'));
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('replays the answer when the retry arrives after the turn finished', async () => {
    const work = vi.fn(async () => turn('logged'));

    await runOnce('u1', 'turn-abc123', work);
    expect(await runOnce('u1', 'turn-abc123', work)).toEqual(turn('logged'));

    expect(work).toHaveBeenCalledTimes(1);
  });

  it('keeps one user out of another user\'s turns', async () => {
    // Same id from two people must never cross: ids are client-generated.
    await runOnce('u1', 'same-id-1234', async () => turn('mine'));

    expect(await runOnce('u2', 'same-id-1234', async () => turn('theirs'))).toEqual(turn('theirs'));
  });

  it('lets a genuinely new message through', async () => {
    const work = vi.fn(async () => turn('ok'));

    await runOnce('u1', 'turn-aaaaaa', work);
    await runOnce('u1', 'turn-bbbbbb', work);

    expect(work).toHaveBeenCalledTimes(2);
  });

  it('allows a real retry after a failure', async () => {
    // A turn that threw did not happen, so the user must be able to try again;
    // only a completed turn is the thing that must not repeat.
    const failing = vi.fn(async () => {
      throw new Error('vertex down');
    });
    await expect(runOnce('u1', 'turn-abc123', failing)).rejects.toThrow('vertex down');

    const work = vi.fn(async () => turn('worked'));
    expect(await runOnce('u1', 'turn-abc123', work)).toEqual(turn('worked'));
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('caches nothing when the client sends no id', async () => {
    // An older app build must behave exactly as it did before.
    const work = vi.fn(async () => turn('ok'));

    await runOnce('u1', undefined, work);
    await runOnce('u1', undefined, work);

    expect(work).toHaveBeenCalledTimes(2);
    expect(cachedTurnCount()).toBe(0);
  });
});
