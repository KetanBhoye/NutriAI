import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The web-grounded nutrition lookup — the tool the coach calls before logging
 * anything, so its numbers become the user's diary.
 *
 * Two things make it worth its own test. Grounding can't be combined with a
 * JSON response schema, so the reply is prose that has to be mined for JSON —
 * a parser, and parsers rot. And web sources mix per-100 g with per-serving
 * figures constantly, which is the single most common way an item arrives
 * carrying more macro energy than the calories it claims.
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

/** The prompt sent on the most recent call. */
const sentPrompt = (): string => vertexFetch.mock.calls.at(-1)![2].contents[0].parts[0].text;

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

    expect(vertexFetch.mock.calls.at(-1)![2].tools).toEqual([{ googleSearch: {} }]);
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
