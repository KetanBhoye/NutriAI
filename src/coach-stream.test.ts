import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from './index.js';
import { getConfig } from './config.js';

/**
 * `POST /api/coach/chat` streaming mode.
 *
 * A coach turn that logs a meal spends 30-60 seconds in the agent loop, and
 * the app could previously show nothing but a spinner. Streaming reports the
 * tool calls as they happen — but the shape of the response is a contract with
 * every build already on a phone, so the two things worth pinning down are:
 *
 *   1. the stream is **opt-in**, and an old client's request still gets the
 *      single JSON object it was written against; and
 *   2. a failure that happens *after* the headers went out still reaches the
 *      client, since the status line is long gone by then.
 */

const runCoachTurn = vi.hoisted(() => vi.fn());
vi.mock('./services/coach/agent.js', () => ({ runCoachTurn }));

let dir: string;
let running: Awaited<ReturnType<typeof createApp>>;

const start = async () => {
  running = await createApp({ ...getConfig(), databasePath: join(dir, 'test.db') });
  return running.app;
};

/** Signs up, returning the session cookie the coach route requires. */
async function signIn(app: Awaited<ReturnType<typeof start>>): Promise<string> {
  const res = await request(app)
    .post('/api/auth/signup')
    .send({ name: 'Test', email: `t${Date.now()}@example.test`, password: 'Test@1234' });
  const raw = res.headers['set-cookie'];
  return (Array.isArray(raw) ? raw : [raw ?? '']).map((c) => c.split(';')[0]).join('; ');
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nutriai-coach-'));
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{}';
  process.env.GCP_PROJECT = 'p';
  runCoachTurn.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  await running?.close();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  delete process.env.GCP_PROJECT;
  vi.restoreAllMocks();
});

const turn = { reply: 'Logged it.', actions: ['add_entry'], history: [] };

describe('POST /api/coach/chat', () => {
  it('answers an old client with one JSON object, as it always did', async () => {
    runCoachTurn.mockResolvedValue(turn);
    const app = await start();
    const cookie = await signIn(app);

    const res = await request(app)
      .post('/api/coach/chat')
      .set('Cookie', cookie)
      .send({ message: 'log 3 eggs' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(turn);
    // And the agent was given no reporter, so nothing tries to write mid-turn.
    expect(runCoachTurn.mock.calls[0]![0].onStep).toBeUndefined();
  });

  it('streams a step per round of tool calls, then the answer', async () => {
    runCoachTurn.mockImplementation(async (opts: { onStep?: (t: string[]) => void }) => {
      opts.onStep?.(['lookup_nutrition']);
      opts.onStep?.(['add_entry', 'add_entry']);
      return turn;
    });
    const app = await start();
    const cookie = await signIn(app);

    const res = await request(app)
      .post('/api/coach/chat')
      .set('Cookie', cookie)
      .send({ message: 'log 3 eggs', stream: true });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/x-ndjson/);

    const lines = res.text.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toEqual([
      { type: 'step', tools: ['lookup_nutrition'] },
      { type: 'step', tools: ['add_entry', 'add_entry'] },
      { type: 'done', ...turn },
    ]);
  });

  it('reports a mid-stream failure as a final line, not a status code', async () => {
    // By the time the agent throws, 200 has already been sent — so an error
    // that only travels as an HTTP status would leave the app waiting forever.
    runCoachTurn.mockImplementation(async (opts: { onStep?: (t: string[]) => void }) => {
      opts.onStep?.(['lookup_nutrition']);
      throw new Error('vertex exploded');
    });
    const app = await start();
    const cookie = await signIn(app);

    const res = await request(app)
      .post('/api/coach/chat')
      .set('Cookie', cookie)
      .send({ message: 'log 3 eggs', stream: true });

    const lines = res.text.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines[0]).toEqual({ type: 'step', tools: ['lookup_nutrition'] });
    expect(lines.at(-1)).toMatchObject({ type: 'error' });
    expect(lines.at(-1).error).toMatch(/could not be reached/i);
  });

  it('still uses a status code when it fails before streaming starts', async () => {
    runCoachTurn.mockRejectedValue(new Error('429 too many requests'));
    const app = await start();
    const cookie = await signIn(app);

    const res = await request(app)
      .post('/api/coach/chat')
      .set('Cookie', cookie)
      .send({ message: 'log 3 eggs' });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/busy/i);
  });

  it('refuses without a session, streaming or not', async () => {
    const app = await start();
    const res = await request(app).post('/api/coach/chat').send({ message: 'hi', stream: true });

    expect(res.status).toBe(401);
  });
});
