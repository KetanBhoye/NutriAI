import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearRatesCache,
  costAt,
  defaultRates,
  parseRates,
  refreshRatesFromGoogle,
} from './rates.js';

beforeEach(() => {
  clearRatesCache();
  delete process.env.GOOGLE_BILLING_API_KEY;
});

describe('parseRates', () => {
  const fallback = defaultRates('gemini-2.5-flash');

  it('takes stored rates over the built-in ones', () => {
    const rates = parseRates(
      { model: 'gemini-3-flash', inputPerM: 0.5, outputPerM: 4, groundedPerQuery: 0.02, source: 'manual' },
      fallback
    );

    expect(rates.inputPerM).toBe(0.5);
    expect(rates.model).toBe('gemini-3-flash');
  });

  it('falls back rather than accepting nonsense', () => {
    for (const bad of [null, 'nope', 42, { inputPerM: 'free' }, { inputPerM: -1, outputPerM: 1 }]) {
      expect(parseRates(bad, fallback).inputPerM).toBe(fallback.inputPerM);
    }
  });

  it('refuses a rate far outside any plausible price', () => {
    // A slipped decimal here would not error — it would quietly exhaust every
    // user's spend cap on their next call.
    const rates = parseRates({ inputPerM: 30_000, outputPerM: 2.5, groundedPerQuery: 0.035 }, fallback);

    expect(rates.inputPerM).toBe(fallback.inputPerM);
  });

  it('keeps a zero rate, which is a real thing a price can be', () => {
    const rates = parseRates(
      { inputPerM: 0, outputPerM: 0, groundedPerQuery: 0, source: 'manual' },
      fallback
    );

    expect(rates.inputPerM).toBe(0);
    expect(rates.outputPerM).toBe(0);
  });
});

describe('costAt', () => {
  it('prices a call at the given rates', () => {
    const rates = { ...defaultRates(), inputPerM: 0.3, outputPerM: 2.5, groundedPerQuery: 0.035 };

    const cost = costAt(rates, { inputTokens: 1_000_000, outputTokens: 1_000_000, groundedQueries: 2 });

    expect(cost).toBeCloseTo(0.3 + 2.5 + 0.07, 6);
  });

  it('tracks a rate change, which is the whole point of it being a value', () => {
    const cheap = { ...defaultRates(), inputPerM: 0.3 };
    const dear = { ...defaultRates(), inputPerM: 3 };
    const call = { inputTokens: 1_000_000, outputTokens: 0, groundedQueries: 0 };

    expect(costAt(dear, call)).toBeCloseTo(costAt(cheap, call) * 10, 6);
  });
});

describe('refreshRatesFromGoogle', () => {
  it('explains what to configure when there is no API key', async () => {
    const result = await refreshRatesFromGoogle('gemini-2.5-flash');

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/GOOGLE_BILLING_API_KEY/);
  });

  it('reads input and output prices out of the catalog', async () => {
    process.env.GOOGLE_BILLING_API_KEY = 'test-key';
    const fetchImpl = fakeCatalog([
      sku('Gemini 2.5 Flash Text Input', 0.3, 'million tokens'),
      sku('Gemini 2.5 Flash Text Output', 2.5, 'million tokens'),
    ]);

    const result = await refreshRatesFromGoogle('gemini-2.5-flash', fetchImpl);

    expect(result.ok).toBe(true);
    expect(result.rates).toEqual({ inputPerM: 0.3, outputPerM: 2.5 });
  });

  it('converts a per-token price to per-million', async () => {
    process.env.GOOGLE_BILLING_API_KEY = 'test-key';
    const fetchImpl = fakeCatalog([
      sku('Gemini 2.5 Flash Input', 0.0000003, 'tokens'),
      sku('Gemini 2.5 Flash Output', 0.0000025, 'tokens'),
    ]);

    const result = await refreshRatesFromGoogle('gemini-2.5-flash', fetchImpl);

    expect(result.rates?.inputPerM).toBeCloseTo(0.3, 6);
    expect(result.rates?.outputPerM).toBeCloseTo(2.5, 6);
  });

  it('reports rather than guesses when it cannot identify the SKUs', async () => {
    process.env.GOOGLE_BILLING_API_KEY = 'test-key';
    const fetchImpl = fakeCatalog([sku('Gemini 2.5 Flash Something Else', 1, 'million tokens')]);

    const result = await refreshRatesFromGoogle('gemini-2.5-flash', fetchImpl);

    // A wrong-but-confident rate would misprice every spend cap. Saying so and
    // handing over the candidate list is the honest failure.
    expect(result.ok).toBe(false);
    expect(result.candidates).toContain('Gemini 2.5 Flash Something Else');
  });

  it('refuses a SKU whose unit it does not understand', async () => {
    process.env.GOOGLE_BILLING_API_KEY = 'test-key';
    const fetchImpl = fakeCatalog([
      sku('Gemini 2.5 Flash Input', 0.3, 'gibibyte hours'),
      sku('Gemini 2.5 Flash Output', 2.5, 'gibibyte hours'),
    ]);

    expect((await refreshRatesFromGoogle('gemini-2.5-flash', fetchImpl)).ok).toBe(false);
  });

  it('survives the catalog being unreachable', async () => {
    process.env.GOOGLE_BILLING_API_KEY = 'test-key';
    const fetchImpl = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    const result = await refreshRatesFromGoogle('gemini-2.5-flash', fetchImpl);

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/network down/);
  });
});

/** One catalog SKU, in the shape the Cloud Billing API returns. */
function sku(description: string, usd: number, unit: string) {
  return {
    description,
    pricingInfo: [
      {
        pricingExpression: {
          usageUnitDescription: unit,
          tieredRates: [
            {
              unitPrice: {
                units: String(Math.floor(usd)),
                nanos: Math.round((usd - Math.floor(usd)) * 1e9),
              },
            },
          ],
        },
      },
    ],
  };
}

function fakeCatalog(skus: unknown[]): typeof fetch {
  return (async (url: string) => ({
    json: async () =>
      String(url).includes('/skus')
        ? { skus }
        : { services: [{ name: 'services/ABCD-1234', displayName: 'Vertex AI' }] },
  })) as unknown as typeof fetch;
}
