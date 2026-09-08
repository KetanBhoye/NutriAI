import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The web-grounded nutrition lookup — the tool the coach calls before logging
 * anything, so its numbers become the user's diary.
 *
 * It runs as two calls: a grounded one that reads the web in prose, then an
 * ungrounded one that turns that prose into numbers. The split exists because
 * ordering a grounded call to emit only JSON silently strips its citations —
 * see the comment on lookupMacrosGrounded, and the regression test below.
 *
 * Note what these tests could not catch on their own. "keeps the sources"
 * passed throughout the period when production returned an empty source list
 * on every single call, because the mock supplied grounding chunks that the
 * real API had stopped providing. A test that hands the code its input can
 * only prove the code reads it — never that the input arrives. That is why
 * the prompt shape is asserted here too: it is the part that decided whether
 * the real API sent anything back.
 */

const vertexFetch = vi.hoisted(() => vi.fn());
vi.mock('../llm/vertex.js', () => ({
  vertexFetch,
  vertexUrl: () => 'https://vertex.test/generate',
}));
vi.mock('../llm/google-auth.js', () => ({ getGoogleAccessToken: async () => 'token' }));

import { macroEnergy } from './macro-sanity.js';
import { lookupMacrosGrounded } from './grounded-macros.js';

const reply = (text: string, chunks: Array<{ web?: { title?: string } }> = []) =>
  vertexFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      candidates: [
        { content: { parts: [{ text }] }, groundingMetadata: { groundingChunks: chunks } },
      ],
    }),
  });

/** The grounded research call — the first of the two. */
const researchBody = () => vertexFetch.mock.calls[0]![2];
/** The ungrounded extraction call that follows it. */
const extractBody = () => vertexFetch.mock.calls[1]![2];
const sentPrompt = (): string => researchBody().contents[0].parts[0].text;

beforeEach(() => {
  vertexFetch.mockReset();
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{}';
  process.env.GCP_PROJECT = 'p';
});

afterEach(() => {
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  delete process.env.GCP_PROJECT;
});

describe('the request', () => {
  it('asks for the stated portion, not per 100 g', async () => {
    reply('{"items":[]}');
    await lookupMacrosGrounded('2 roti');

    expect(sentPrompt()).toMatch(/not per 100 ?g/i);
    expect(sentPrompt()).toMatch(/LOWER end/);
  });

  it('actually searches the web, which is the point of this path', async () => {
    reply('{"items":[]}');
    await lookupMacrosGrounded('2 roti');

    expect(researchBody().tools).toEqual([{ googleSearch: {} }]);
  });

  /**
   * The regression that cost the feature its entire reason for existing.
   *
   * Telling a grounded call to return only JSON makes the model search and
   * then answer with a bare object — and a bare object gives the grounding
   * system nothing to attach citations to, so `groundingChunks` comes back
   * empty every time. Measured against the shipped prompt: 0 chunks with the
   * JSON instruction, 4 without it. The numbers then come from the model's
   * memory while still being billed as a grounded query.
   *
   * So the research call must never ask for JSON. If a future change moves
   * the schema onto this call to save a round trip, this fails.
   */
  it('never asks the grounded call for JSON, which would strip its citations', async () => {
    reply('{"items":[]}');
    await lookupMacrosGrounded('2 roti');

    expect(sentPrompt()).not.toMatch(/\bJSON\b/i);
    expect(researchBody().generationConfig?.responseSchema).toBeUndefined();
    expect(researchBody().generationConfig?.responseMimeType).toBeUndefined();
  });

  it('extracts with a schema, and without searching again', async () => {
    reply('{"items":[]}');
    await lookupMacrosGrounded('2 roti');

    // Cheap, deterministic, and unable to wander off and look anything up.
    expect(extractBody().tools).toBeUndefined();
    expect(extractBody().generationConfig.responseMimeType).toBe('application/json');
  });

  it('refuses to run without Vertex configured, rather than returning zeros', async () => {
    delete process.env.GCP_PROJECT;
    await expect(lookupMacrosGrounded('2 roti')).rejects.toThrow(/not configured/i);
  });
});

describe('reading the reply', () => {
  it('mines JSON out of a fenced, prose-wrapped answer', async () => {
    reply(
      'Here are the values you asked for:\n```json\n' +
        '{"items":[{"name":"Roti (2)","calories":200,"protein_g":6,"carbs_g":36,"fat_g":4}]}\n' +
        '```\nHope that helps!'
    );

    const { items } = await lookupMacrosGrounded('2 roti');
    expect(items).toEqual([{ name: 'Roti (2)', calories: 200, protein_g: 6, carbs_g: 36, fat_g: 4 }]);
  });

  it('scales down an item quoting per-100 g macros against a per-serving calorie count', async () => {
    // 30 g protein and 60 g carbs cannot live in a 250 kcal serving.
    reply('{"items":[{"name":"Paneer bhurji","calories":250,"protein_g":30,"carbs_g":60,"fat_g":12}]}');

    const { items } = await lookupMacrosGrounded('paneer bhurji');
    expect(items[0].calories).toBe(250);
    expect(items[0].protein_g).toBeLessThan(30);
    expect(macroEnergy(items[0])).toBeLessThanOrEqual(250 * 1.1);
  });

  it('keeps the sources, so a number can be traced back', async () => {
    reply('{"items":[]}', [{ web: { title: 'USDA FoodData Central' } }]);

    const { sources } = await lookupMacrosGrounded('2 roti');
    expect(sources).toEqual(['USDA FoodData Central']);
  });

  it('never returns a negative macro, whatever arrives', async () => {
    reply('{"items":[{"name":"X","calories":100,"protein_g":-5,"carbs_g":10,"fat_g":2}]}');

    const { items } = await lookupMacrosGrounded('x');
    expect(items[0].protein_g).toBe(0);
  });
});
