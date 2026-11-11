import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  claimJob,
  completeJob,
  geminiBodyToMacJob,
  macComputeOnline,
  macGenerate,
  macResultToGemini,
  noteWorkerSeen,
  requeueJob,
  resetMacComputeForTests,
  setMacComputeEnabled,
  submitMacJob,
  verifyMacToken,
} from './mac-compute.js';
import { CONSERVATIVE_ESTIMATION_RULES } from '../coach/macro-sanity.js';

const TOKEN = 'test-token-0123456789abcdef';

beforeEach(() => {
  process.env.MAC_COMPUTE_TOKEN = TOKEN;
  resetMacComputeForTests();
});
afterEach(() => {
  resetMacComputeForTests();
  process.env.MAC_COMPUTE_TOKEN = undefined;
});

const textJob = { tier: 'fast' as const, system: 's', content: [], webSearch: false, timeoutMs: 500 };

describe('mac compute queue', () => {
  it('is offline until a worker has polled, and without a token never online', () => {
    expect(macComputeOnline()).toBe(false);
    noteWorkerSeen();
    expect(macComputeOnline()).toBe(true);
    process.env.MAC_COMPUTE_TOKEN = undefined;
    expect(macComputeOnline()).toBe(false);
  });

  it('checks the worker token exactly', () => {
    expect(verifyMacToken(TOKEN)).toBe(true);
    expect(verifyMacToken(`${TOKEN}x`)).toBe(false);
    expect(verifyMacToken(undefined)).toBe(false);
    process.env.MAC_COMPUTE_TOKEN = 'short';
    expect(verifyMacToken('short')).toBe(false);
  });

  it('refuses work while offline so the caller falls back at once', async () => {
    await expect(submitMacJob(textJob)).rejects.toThrow(/offline/);
  });

  it('hands a queued job to the next claim and resolves on its result', async () => {
    noteWorkerSeen();
    const answer = submitMacJob(textJob);
    const job = await claimJob(50);
    expect(job?.system).toBe('s');
    expect(completeJob(job!.id, { ok: true, result: { text: 'hi', ms: 12 } })).toBe(true);
    await expect(answer).resolves.toMatchObject({ text: 'hi' });
    // A second delivery finds nobody waiting.
    expect(completeJob(job!.id, { ok: true, result: { text: 'again' } })).toBe(false);
  });

  it('wakes a worker that is already waiting', async () => {
    noteWorkerSeen();
    const claim = claimJob(1000);
    const answer = submitMacJob(textJob);
    const job = await claim;
    completeJob(job!.id, { ok: false, error: 'boom' });
    await expect(answer).rejects.toThrow(/boom/);
  });

  it('returns null from an idle claim, and times out an unanswered job', async () => {
    noteWorkerSeen();
    expect(await claimJob(10)).toBeNull();
    await expect(submitMacJob({ ...textJob, timeoutMs: 20 })).rejects.toThrow(/timed out/);
  });

  it('never hands a job to a worker whose connection has closed', async () => {
    noteWorkerSeen();
    const gone = new AbortController();
    const dead = claimJob(1000, gone.signal);
    gone.abort();
    expect(await dead).toBeNull();

    const answer = submitMacJob(textJob);
    // Still queued for a live worker, rather than lost to the dead one.
    const job = await claimJob(50);
    expect(job).not.toBeNull();

    // Handed over in the same instant the connection dropped: goes back first.
    requeueJob(job!.id);
    const again = await claimJob(50);
    expect(again?.id).toBe(job!.id);
    completeJob(again!.id, { ok: true, result: { text: 'ok' } });
    await expect(answer).resolves.toMatchObject({ text: 'ok' });
  });

  it('drops queued work when switched off', async () => {
    noteWorkerSeen();
    const answer = submitMacJob(textJob);
    setMacComputeEnabled(false);
    await expect(answer).rejects.toThrow(/switched off/);
    expect(macComputeOnline()).toBe(false);
    expect(await claimJob(10)).toBeNull();
  });
});

describe('gemini bridge', () => {
  it('turns a schema request into a structured job and back into Vertex text', async () => {
    const body = {
      system_instruction: { parts: [{ text: 'SYS' }] },
      contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
      generationConfig: {
        responseSchema: {
          type: 'OBJECT',
          properties: { n: { type: 'INTEGER' }, s: { type: 'STRING', nullable: true } },
          required: ['n'],
        },
      },
    };
    const job = geminiBodyToMacJob(body);
    expect(job.tier).toBe('fast');
    expect(job.system.startsWith('SYS')).toBe(true);
    expect(job.schema).toEqual({
      type: 'object',
      properties: { n: { type: 'integer' }, s: { type: ['string', 'null'] } },
      required: ['n'],
    });

    noteWorkerSeen();
    const pending = macGenerate(body);
    const claimed = await claimJob(50);
    completeJob(claimed!.id, { ok: true, result: { structured: { n: 3 } } });
    const res = await pending;
    expect(res.headers.get('x-nutriai-compute')).toBe('mac');
    const data = (await res.json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
      usageMetadata: { promptTokenCount: number };
    };
    expect(JSON.parse(data.candidates[0]!.content.parts[0]!.text)).toEqual({ n: 3 });
    // Unbilled work must not be priced against the daily budget.
    expect(data.usageMetadata.promptTokenCount).toBe(0);
  });

  it('sends a photo as an image block on the accurate tier', () => {
    const job = geminiBodyToMacJob({
      contents: [
        { role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: 'AAAA' } }, { text: 'what' }] },
      ],
    });
    expect(job.tier).toBe('accurate');
    expect(job.content).toEqual([
      { type: 'image', mimeType: 'image/jpeg', data: 'AAAA' },
      { type: 'text', text: 'what' },
    ]);
  });

  it('maps a grounded search to web search with cited sources', () => {
    const job = geminiBodyToMacJob({
      contents: [{ role: 'user', parts: [{ text: 'find' }] }],
      tools: [{ googleSearch: {} }],
    });
    expect(job.webSearch).toBe(true);
    const out = macResultToGemini(job, {
      structured: {
        findings: 'Paneer 100 g: 290 kcal',
        sources: [
          { title: 'IFCT', url: 'https://ifct.example/paneer' },
          { title: 'not a link', url: 'javascript:alert(1)' },
        ],
      },
    }) as { candidates: Array<{ groundingMetadata: { groundingChunks: unknown[] } }> };
    expect(out.candidates[0]!.groundingMetadata.groundingChunks).toEqual([
      { web: { uri: 'https://ifct.example/paneer', title: 'IFCT' } },
    ]);
  });

  it('runs a coach step as a transcript, returning tool calls or a reply', () => {
    const job = geminiBodyToMacJob({
      system_instruction: { parts: [{ text: 'COACH' }] },
      contents: [
        { role: 'user', parts: [{ text: 'log 2 roti' }] },
        { role: 'model', parts: [{ functionCall: { name: 'lookup_nutrition', args: { foods: '2 roti' } } }] },
        { role: 'user', parts: [{ functionResponse: { name: 'lookup_nutrition', response: { output: '{"items":[]}' } } }] },
      ],
      tools: [
        {
          functionDeclarations: [
            {
              name: 'add_entry',
              description: 'Log a food',
              parameters: {
                type: 'OBJECT',
                properties: { calories: { type: 'INTEGER' } },
                required: ['calories'],
              },
            },
          ],
        },
      ],
    });
    expect(job.tier).toBe('accurate');
    const transcript = (job.content[0] as { text: string }).text;
    expect(transcript).toContain('<user>log 2 roti</user>');
    expect(transcript).toContain('<tool_call name="lookup_nutrition">{"foods":"2 roti"}</tool_call>');
    expect(transcript).toContain('<tool_result name="lookup_nutrition">{"items":[]}</tool_result>');
    expect(job.schema).toBeUndefined();
    expect(job.tools).toEqual([
      {
        name: 'add_entry',
        description: 'Log a food',
        inputSchema: {
          type: 'object',
          properties: { calories: { type: 'integer' } },
          required: ['calories'],
        },
      },
    ]);

    const calls = macResultToGemini(job, {
      toolCalls: [
        { name: 'add_entry', args: { calories: 200 } },
        // A tool the app never offered must not reach the handlers.
        { name: 'rm_rf', args: {} },
      ],
    }) as { candidates: Array<{ content: { parts: unknown[] } }> };
    expect(calls.candidates[0]!.content.parts).toEqual([
      { functionCall: { name: 'add_entry', args: { calories: 200 } } },
    ]);

    const reply = macResultToGemini(job, { text: 'Logged.', toolCalls: [] }) as {
      candidates: Array<{ content: { parts: unknown[] } }>;
    };
    expect(reply.candidates[0]!.content.parts).toEqual([{ text: 'Logged.' }]);
    expect(() => macResultToGemini(job, { text: '' })).toThrow();
  });
});

describe('reference values', () => {
  it('never list macros that carry more energy than the calories beside them', () => {
    const rows = [...CONSERVATIVE_ESTIMATION_RULES.matchAll(
      /: (\d+) kcal, ([\d.]+) g protein, ([\d.]+) g carbs, ([\d.]+) g fat/g
    )];
    expect(rows.length).toBeGreaterThan(20);
    for (const [row, kcal, p, c, f] of rows) {
      const energy = Number(p) * 4 + Number(c) * 4 + Number(f) * 9;
      expect(energy, row).toBeLessThanOrEqual(Number(kcal) * 1.05);
      expect(energy, row).toBeGreaterThanOrEqual(Number(kcal) * 0.85);
    }
  });
});
