import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The client half of the duplicate-entry fix.
 *
 * The server refuses to run the same `turn_id` twice — that is tested in
 * `services/coach/turn-cache.test.ts`. None of it helps if the client sends a
 * *different* id on the retry, and that is a one-word mistake away: the
 * fallback used to re-send `input`, and re-sending `input` again would be
 * invisible in review and would bring the duplicates straight back.
 */

const readNdjson = vi.hoisted(() => vi.fn());
const api = vi.hoisted(() => vi.fn());

vi.mock('./ndjson', () => ({
  readNdjson,
  NdjsonError: class NdjsonError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock('./client', () => ({
  api,
  loadStoredCookie: async () => 'ct_sid=test',
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

import { coachChatStreaming, newTurnId } from './ai';

const reply = { reply: 'Logged 2 rotis.', actions: ['add_entry'], history: [] };

beforeEach(() => {
  readNdjson.mockReset();
  api.mockReset().mockResolvedValue(reply);
});

describe('coachChatStreaming', () => {
  it('stamps the streamed request with a turn id', async () => {
    readNdjson.mockImplementation(async (opts: { onLine: (v: unknown) => void }) => {
      opts.onLine({ type: 'done', ...reply });
    });

    await coachChatStreaming({ message: '2 rotis', history: [] }, () => {});

    const body = readNdjson.mock.calls[0]![0].body as { turn_id?: string };
    expect(body.turn_id).toMatch(/^t/);
  });

  it('retries with the SAME id when the stream dies — the duplicate-entry fix', async () => {
    // Exactly what backgrounding the app does: the connection drops after the
    // agent has already written the entries.
    readNdjson.mockRejectedValue(new Error('Network error — check your connection.'));

    await coachChatStreaming({ message: '2 rotis', history: [] }, () => {});

    const streamed = readNdjson.mock.calls[0]![0].body as { turn_id?: string };
    const retried = api.mock.calls[0]![1].body as { turn_id?: string };

    expect(retried.turn_id).toBe(streamed.turn_id);
    expect(retried.turn_id).toBeTruthy();
  });

  it('keeps an id the caller supplied, rather than minting a second one', async () => {
    readNdjson.mockRejectedValue(new Error('boom'));

    await coachChatStreaming({ message: 'hi', history: [], turn_id: 'given-id-123' }, () => {});

    expect((api.mock.calls[0]![1].body as { turn_id?: string }).turn_id).toBe('given-id-123');
  });

  it('gives two separate messages two separate ids', async () => {
    readNdjson.mockImplementation(async (opts: { onLine: (v: unknown) => void }) => {
      opts.onLine({ type: 'done', ...reply });
    });

    await coachChatStreaming({ message: 'first', history: [] }, () => {});
    await coachChatStreaming({ message: 'second', history: [] }, () => {});

    const first = (readNdjson.mock.calls[0]![0].body as { turn_id: string }).turn_id;
    const second = (readNdjson.mock.calls[1]![0].body as { turn_id: string }).turn_id;
    expect(first).not.toBe(second);
  });
});

describe('newTurnId', () => {
  it('does not collide across a burst', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newTurnId()));

    expect(ids.size).toBe(500);
  });
});
