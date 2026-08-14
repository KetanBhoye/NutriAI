import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What actually reaches the model, and what we do with what comes back.
 *
 * The model itself isn't exercised here — Vertex needs credentials this suite
 * doesn't have. What can be checked is everything the repetition complaint was
 * caused by: a prompt that named the dishes it wanted back, a budget stated as
 * a vague hint, and no memory of what the user had already been shown.
 */

const vertexFetch = vi.hoisted(() => vi.fn());
vi.mock('../llm/vertex.js', () => ({
  vertexFetch,
  vertexUrl: () => 'https://vertex.test/generate',
}));
vi.mock('../llm/google-auth.js', () => ({ getGoogleAccessToken: async () => 'token' }));

import { generateMealSuggestions } from './suggest-meal.js';

const reply = (suggestions: Array<Record<string, unknown>>) =>
  vertexFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ suggestions }) }] }, }],
    }),
  });

const dish = (name: string, calories: number) => ({
  name,
  description: 'x',
  calories,
  protein_g: 20,
  carbs_g: 30,
  fat_g: 10,
});

/** The system prompt sent on the most recent call. */
const sentPrompt = (): string => vertexFetch.mock.calls.at(-1)![2].system_instruction.parts[0].text;

const generate = (over: Record<string, unknown> = {}) =>
  generateMealSuggestions({
    remainingCalories: 1200,
    remainingProtein: 60,
    mealType: 'dinner',
    dietNotes: null,
    credentialJson: '{}',
    project: 'p',
    location: 'l',
    model: 'm',
    ...over,
  });

beforeEach(() => {
  vertexFetch.mockReset();
});

describe('the prompt', () => {
  it('states the calorie band as numbers, not as a hint', async () => {
    reply([dish('a', 400)]);
    await generate();

    // "roughly fit the calories left" gave the model nothing to hit.
    expect(sentPrompt()).toMatch(/MUST be between \d+ and \d+ kcal/);
  });

  it('no longer names the dishes it wants back', async () => {
    reply([dish('a', 400)]);
    await generate();

    // This list *was* the bug: the model returned the examples it was given,
    // so every ask produced the same handful of plates.
    const prompt = sentPrompt();
    for (const dishName of ['moong dal chilla', 'curd rice', 'paneer bhurji', 'poha', 'upma']) {
      expect(prompt.toLowerCase()).not.toContain(dishName);
    }
  });

  it('passes on what the user has already eaten or seen', async () => {
    reply([dish('a', 400)]);
    await generate({ avoid: ['Poha', 'Rajma chawal'] });

    expect(sentPrompt()).toContain('Poha, Rajma chawal');
  });

  it('tells the model when the day is already spent', async () => {
    reply([dish('a', 80)]);
    await generate({ remainingCalories: -300 });

    expect(sentPrompt()).toMatch(/ALREADY MET/);
  });

  it('varies its angle between calls, so re-asking is a new question', async () => {
    reply([dish('a', 400)]);
    const angles = new Set<string>();
    for (let i = 0; i < 25; i++) {
      await generate();
      angles.add(sentPrompt().match(/lean towards: ([^.]+)\./)![1]!);
    }

    expect(angles.size).toBeGreaterThan(1);
  });
});

describe('the response', () => {
  it('keeps the options that fit the budget, not the first three returned', async () => {
    // 300 kcal left at dinner: the 900 kcal plate must not survive, however
    // confidently the model offered it first.
    reply([dish('big thali', 900), dish('khichdi', 260), dish('dal & rice', 240)]);

    const out = await generate({ remainingCalories: 300 });

    expect(out.map((s) => s.name)).not.toContain('big thali');
    expect(out).toHaveLength(2);
  });

  it('returns at most three', async () => {
    reply([dish('a', 400), dish('b', 410), dish('c', 420), dish('d', 430), dish('e', 440)]);

    expect(await generate()).toHaveLength(3);
  });

  it('still answers when nothing the model returned fits', async () => {
    // An empty sheet reads as a broken feature; the closest option is better.
    reply([dish('huge', 1500), dish('huger', 1800)]);

    expect((await generate({ remainingCalories: 200 })).length).toBeGreaterThan(0);
  });
});
