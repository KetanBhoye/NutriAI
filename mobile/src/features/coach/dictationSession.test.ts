import { describe, expect, it } from 'vitest';
import {
  idleSession,
  reduceSession,
  sessionText,
  type SessionEvent,
  type SessionState,
} from './dictationSession';

/** Replays a sequence, collecting whatever the session handed over. */
function run(events: SessionEvent[], from: SessionState = idleSession) {
  let state = from;
  const emitted: string[] = [];
  for (const event of events) {
    const result = reduceSession(state, event);
    state = result.state;
    if (result.emit !== undefined) emitted.push(result.emit);
  }
  return { state, emitted };
}

const start: SessionEvent = { type: 'start' };
const final = (text: string): SessionEvent => ({ type: 'result', text, isFinal: true });
const interim = (text: string): SessionEvent => ({ type: 'result', text, isFinal: false });

describe('a normal session', () => {
  it('shows interim words as they arrive, then keeps the final', () => {
    const { state } = run([start, interim('two rot'), interim('two rotis')]);
    expect(sessionText(state)).toBe('two rotis');
    expect(state.active).toBe(true);
  });

  it('hands the text over exactly once, on end', () => {
    const { emitted, state } = run([start, final('two rotis and dal'), { type: 'end' }]);
    expect(emitted).toEqual(['two rotis and dal']);
    expect(state.active).toBe(false);
  });

  it('includes an unfinalised phrase when the session ends mid-word', () => {
    const { emitted } = run([start, final('two rotis'), interim('and dal'), { type: 'end' }]);
    expect(emitted).toEqual(['two rotis and dal']);
  });
});

describe('the flooding bug', () => {
  it('holds one copy however many times iOS repeats the final', () => {
    const repeats = Array.from({ length: 10 }, () => final('What are you doing?'));
    const { state } = run([start, ...repeats]);
    expect(sessionText(state)).toBe('What are you doing?');
  });

  it('collects Android segments instead of overwriting them', () => {
    const { emitted } = run([
      start,
      final('Two rotis'),
      final('and a bowl of dal'),
      final('for lunch'),
      { type: 'end' },
    ]);
    expect(emitted).toEqual(['Two rotis and a bowl of dal for lunch']);
  });
});

describe('sending exactly once', () => {
  it('ignores a second end event', () => {
    const { emitted } = run([start, final('two rotis'), { type: 'end' }, { type: 'end' }]);
    expect(emitted).toEqual(['two rotis']);
  });

  it('ignores the stop watchdog once end has already fired', () => {
    const { emitted } = run([start, final('two rotis'), { type: 'end' }, { type: 'timeout' }]);
    expect(emitted).toEqual(['two rotis']);
  });

  it('uses the watchdog when end never comes — the stuck-mic case', () => {
    const { emitted, state } = run([start, final('two rotis'), { type: 'timeout' }]);
    expect(emitted).toEqual(['two rotis']);
    expect(state.active).toBe(false);
  });

  it('emits nothing for a session that heard only silence', () => {
    expect(run([start, { type: 'end' }]).emitted).toEqual([]);
  });

  it('emits nothing when the session errored', () => {
    const { emitted } = run([start, final('two rotis'), { type: 'error' }, { type: 'end' }]);
    expect(emitted).toEqual([]);
  });

  it('emits nothing when the user cancelled', () => {
    const { emitted } = run([start, final('two rotis'), { type: 'cancel' }, { type: 'end' }]);
    expect(emitted).toEqual([]);
  });
});

describe('events outside a session', () => {
  it('ignores a result that arrives after the session ended', () => {
    const { state, emitted } = run([start, final('two rotis'), { type: 'end' }, final('stray')]);
    expect(emitted).toEqual(['two rotis']);
    expect(state.active).toBe(false);
  });

  it('ignores an end with no session at all', () => {
    expect(run([{ type: 'end' }]).emitted).toEqual([]);
  });

  it('starts clean, keeping nothing from the session before', () => {
    const { state } = run([start, final('two rotis'), { type: 'end' }, start]);
    expect(sessionText(state)).toBe('');
    expect(state.active).toBe(true);
    expect(state.emitted).toBe(false);
  });

  it('can run a second session straight after the first', () => {
    const { emitted } = run([
      start,
      final('two rotis'),
      { type: 'end' },
      start,
      final('and three eggs'),
      { type: 'end' },
    ]);
    expect(emitted).toEqual(['two rotis', 'and three eggs']);
  });
});
