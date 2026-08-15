import { describe, expect, it } from 'vitest';
import { completeLines } from './ndjson';

/**
 * `XMLHttpRequest.responseText` is **cumulative** — every progress event hands
 * you everything received so far, not the new bytes. Treating it as a delta
 * replays every earlier line on every event, which in the Coach would show the
 * same step over and over while the real work moved on. That is the bug these
 * tests exist for.
 */
describe('completeLines', () => {
  it('parses whole lines and reports where to resume', () => {
    const text = '{"type":"step"}\n{"type":"done"}\n';
    const { values, consumed } = completeLines(text, 0);

    expect(values).toEqual([{ type: 'step' }, { type: 'done' }]);
    expect(consumed).toBe(text.length);
  });

  it('does not replay lines already consumed', () => {
    const first = '{"n":1}\n';
    const second = `${first}{"n":2}\n`;

    const a = completeLines(first, 0);
    const b = completeLines(second, a.consumed);

    expect(a.values).toEqual([{ n: 1 }]);
    // The whole response is passed again; only the new line comes back.
    expect(b.values).toEqual([{ n: 2 }]);
  });

  it('waits for a line split across two chunks', () => {
    const partial = '{"n":1}\n{"ty';
    const a = completeLines(partial, 0);
    expect(a.values).toEqual([{ n: 1 }]);

    // The cursor stays before the fragment, so the rest completes it.
    const whole = `${partial}pe":"done"}\n`;
    const b = completeLines(whole, a.consumed);
    expect(b.values).toEqual([{ type: 'done' }]);
  });

  it('skips a malformed line rather than losing the turn', () => {
    // One bad progress update must not take down an answer that is otherwise
    // on its way.
    const { values } = completeLines('not json\n{"type":"done"}\n', 0);
    expect(values).toEqual([{ type: 'done' }]);
  });

  it('ignores blank lines', () => {
    const { values } = completeLines('\n\n{"n":1}\n\n', 0);
    expect(values).toEqual([{ n: 1 }]);
  });

  it('returns nothing when no line has completed yet', () => {
    const { values, consumed } = completeLines('{"partial":', 0);
    expect(values).toEqual([]);
    expect(consumed).toBe(0);
  });
});
