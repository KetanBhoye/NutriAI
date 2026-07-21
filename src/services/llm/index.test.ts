import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProviderFromEnv, parseFoodLog } from './index.js';
import type { LlmProvider, ParseContext } from './types.js';

const context: ParseContext = {
  today: '2026-07-21',
  knownFoods: [
    { name: 'Avvatar Whey (1 scoop)', unit: 'scoop', calories_per_unit: 130, protein_per_unit: 29 },
  ],
};

/** A provider that returns whatever raw object the test hands it. */
function fakeProvider(raw: unknown): LlmProvider {
  return { name: 'fake', parseFoodLog: async () => raw };
}

describe('parseFoodLog validation', () => {
  it('accepts a well-formed result', async () => {
    const result = await parseFoodLog(
      fakeProvider({
        understood: true,
        clarification: null,
        entry_date: '2026-07-21',
        items: [
          {
            food_name: 'Chapati (2)',
            quantity: 2,
            unit: 'piece',
            meal_type: 'lunch',
            calories: 160,
            protein_g: 6,
            carbs_g: 32,
            fat_g: 4,
          },
        ],
      }),
      'two chapatis for lunch',
      context
    );

    expect(result.understood).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.food_name).toBe('Chapati (2)');
    expect(result.provider).toBe('fake');
  });

  it('rejects an implausible calorie value rather than logging it', async () => {
    // The safety boundary: a hallucinated 90,000 kcal item must not reach the
    // log. Validation fails, so the whole result degrades to a clarification.
    const result = await parseFoodLog(
      fakeProvider({
        understood: true,
        clarification: null,
        entry_date: '2026-07-21',
        items: [
          {
            food_name: 'Rice',
            quantity: 1,
            unit: 'serving',
            meal_type: 'dinner',
            calories: 90000,
            protein_g: 5,
            carbs_g: 40,
            fat_g: 1,
          },
        ],
      }),
      'some rice',
      context
    );

    expect(result.understood).toBe(false);
    expect(result.items).toHaveLength(0);
    expect(result.clarification).toBeTruthy();
  });

  it('degrades a malformed shape to a clarification instead of throwing', async () => {
    const result = await parseFoodLog(
      fakeProvider({ garbage: true }),
      'anything',
      context
    );

    expect(result.understood).toBe(false);
    expect(result.clarification).toContain('food');
  });

  it('passes through a not-understood message with the model\'s question', async () => {
    const result = await parseFoodLog(
      fakeProvider({
        understood: false,
        clarification: 'How much biryani did you have?',
        entry_date: '2026-07-21',
        items: [],
      }),
      'I had biryani',
      context
    );

    expect(result.understood).toBe(false);
    expect(result.clarification).toBe('How much biryani did you have?');
  });

  it('rejects a bad entry_date format', async () => {
    const result = await parseFoodLog(
      fakeProvider({
        understood: true,
        clarification: null,
        entry_date: 'yesterday',
        items: [],
      }),
      'x',
      context
    );

    expect(result.understood).toBe(false);
  });
});

describe('createProviderFromEnv', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    vi.unstubAllEnvs();
  });

  it('returns null when no key is set', () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_PROVIDER;
    expect(createProviderFromEnv()).toBeNull();
  });

  it('selects Anthropic by default when its key is present', () => {
    delete process.env.LLM_PROVIDER;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    expect(createProviderFromEnv()?.name).toBe('anthropic');
  });

  it('selects OpenAI when LLM_PROVIDER=openai and its key is present', () => {
    process.env.LLM_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    expect(createProviderFromEnv()?.name).toBe('openai');
  });

  it('returns null when the chosen provider has no key even if the other does', () => {
    process.env.LLM_PROVIDER = 'openai';
    delete process.env.OPENAI_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    expect(createProviderFromEnv()).toBeNull();
  });
});
