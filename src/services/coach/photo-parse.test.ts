import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The meal-photo path, from "what we ask the model" to "what we hand the user".
 *
 * The model isn't exercised — Vertex needs credentials this suite doesn't
 * have. What is exercised is the part that was actually wrong: a vision
 * estimate is the easiest place for protein to be inflated unnoticed, because
 * nobody can check a photo against a label. So the guarantee worth testing is
 * that no item reaches the confirm screen claiming more macro energy than its
 * own calorie figure, whatever the model says.
 */

const vertexFetch = vi.hoisted(() => vi.fn());
vi.mock('../llm/vertex.js', () => ({
  vertexFetch,
  vertexUrl: () => 'https://vertex.test/generate',
}));
vi.mock('../llm/google-auth.js', () => ({ getGoogleAccessToken: async () => 'token' }));

import { macroEnergy } from './macro-sanity.js';
import { parseMealPhoto, type PhotoItem } from './photo-parse.js';

const reply = (payload: Record<string, unknown>) =>
  vertexFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
    }),
  });

const parse = () =>
  parseMealPhoto({
    imageBase64: 'AAAA',
    mimeType: 'image/jpeg',
    knownFoods: '- Dal: 120 kcal per katori',
    credentialJson: '{}',
    project: 'p',
    location: 'us-central1',
    model: 'gemini-2.5-flash',
  });

/** The system prompt sent on the most recent call. */
const sentPrompt = (): string => vertexFetch.mock.calls.at(-1)![2].system_instruction.parts[0].text;

const item = (over: Partial<PhotoItem> = {}): PhotoItem => ({
  food_name: 'Dal',
  quantity: 1,
  unit: 'katori',
  calories: 120,
  protein_g: 6,
  carbs_g: 18,
  fat_g: 3,
  ...over,
});

beforeEach(() => {
  vertexFetch.mockReset();
});

describe('the prompt', () => {
  it('carries the conservative estimation rules', async () => {
    reply({ understood: true, note: 'x', items: [] });
    await parse();

    // Without these the model reads home portions as restaurant ones.
    expect(sentPrompt()).toMatch(/LOWER end/);
    expect(sentPrompt()).toMatch(/over-estimating is not/);
    expect(sentPrompt()).toContain('Roti / chapati');
  });

  it("still passes the user's own known foods, which beat any anchor", async () => {
    reply({ understood: true, note: 'x', items: [] });
    await parse();

    expect(sentPrompt()).toContain('Dal: 120 kcal per katori');
  });
});

describe('what reaches the confirm screen', () => {
  it('cuts an inflated estimate down to the calories it claims', async () => {
    // The failure this exists for: a 350 kcal thali with 30 g of protein.
    reply({
      understood: true,
      note: 'Veg thali',
      items: [item({ food_name: 'Thali', calories: 350, protein_g: 30, carbs_g: 60, fat_g: 10 })],
    });

    const { items } = await parse();
    expect(items[0].protein_g).toBeLessThan(30);
    expect(macroEnergy(items[0])).toBeLessThanOrEqual(350 * 1.1);
  });

  it('leaves an honest estimate alone', async () => {
    reply({ understood: true, note: 'Dal', items: [item()] });

    const { items } = await parse();
    expect(items[0]).toMatchObject({ calories: 120, protein_g: 6, carbs_g: 18, fat_g: 3 });
  });

  it('does not invent protein when the macros come in low', async () => {
    // Under-reporting is the acceptable direction — see macro-sanity.ts.
    reply({
      understood: true,
      note: 'Rice',
      items: [item({ food_name: 'Rice', calories: 300, protein_g: 4, carbs_g: 44, fat_g: 1 })],
    });

    const { items } = await parse();
    expect(items[0].protein_g).toBe(4);
    expect(items[0].calories).toBe(300);
  });

  it('reports a non-food photo rather than guessing at it', async () => {
    reply({ understood: false, note: 'Not food', items: [] });

    const { understood, items } = await parse();
    expect(understood).toBe(false);
    expect(items).toEqual([]);
  });

  it('caps a runaway response at twelve items', async () => {
    reply({ understood: true, note: 'x', items: Array.from({ length: 30 }, () => item()) });

    const { items } = await parse();
    expect(items).toHaveLength(12);
  });

  it('throws when Vertex fails, so the caller can say so plainly', async () => {
    vertexFetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });

    await expect(parse()).rejects.toThrow(/500/);
  });
});
