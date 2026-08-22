import type { D1DatabaseCompat } from '../../db/types.js';
import { getSetting, setSetting, SETTINGS } from '../settings.js';
import {
  GROUNDED_FREE_PER_DAY,
  GROUNDED_PER_QUERY,
  INPUT_PER_M,
  OUTPUT_PER_M,
} from './pricing.js';

/**
 * What the model currently costs, as a value that can change without a deploy.
 *
 * The rates used to be constants. That was fine until they were wrong: Google
 * changes list prices, the app changes models, and a hardcoded number turns
 * every cost figure — the admin dashboard, the per-user spend caps, the daily
 * budget brake — into confident fiction. Nothing warns you, because the
 * arithmetic still works.
 *
 * So rates live in `app_settings`, are editable by an admin, and record where
 * they came from and when. `refreshRatesFromGoogle` can propose current values
 * from the Cloud Billing Catalog, but it is never trusted blindly: a parse it
 * is not sure about is reported, not applied. Wrong-and-automatic is worse
 * than stale-and-known, because stale is visible on the page.
 */

export interface AiRates {
  model: string;
  inputPerM: number;
  outputPerM: number;
  groundedPerQuery: number;
  groundedFreePerDay: number;
  /** Where these came from: 'default', 'manual', or 'google-billing-catalog'. */
  source: string;
  /** ISO timestamp of when they were last set, or null for the built-in defaults. */
  updatedAt: string | null;
}

export function defaultRates(model = process.env.LLM_MODEL || 'gemini-2.5-flash'): AiRates {
  return {
    model,
    inputPerM: INPUT_PER_M,
    outputPerM: OUTPUT_PER_M,
    groundedPerQuery: GROUNDED_PER_QUERY,
    groundedFreePerDay: GROUNDED_FREE_PER_DAY,
    source: 'default',
    updatedAt: null,
  };
}

/**
 * Rates are read on the path of every priced call, so they are cached. Sixty
 * seconds because an admin who edits a rate wants to see it take effect while
 * they are still looking at the page.
 */
const CACHE_MS = 60_000;
let cache: { at: number; rates: AiRates } | null = null;

export function clearRatesCache(): void {
  cache = null;
}

/** Rejects anything that would silently produce nonsense costs downstream. */
export function parseRates(raw: unknown, fallback: AiRates): AiRates {
  if (!raw || typeof raw !== 'object') return fallback;
  const r = raw as Record<string, unknown>;

  const number = (value: unknown, min: number, max: number): number | null => {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  };

  // Upper bounds are sanity rails, not policy: a rate 100x the current one is
  // a typo or a bad parse, and applying it would refuse every user's next call
  // by blowing through the spend caps.
  const inputPerM = number(r.inputPerM, 0, 1000);
  const outputPerM = number(r.outputPerM, 0, 1000);
  const groundedPerQuery = number(r.groundedPerQuery, 0, 10);
  const groundedFreePerDay = number(r.groundedFreePerDay, 0, 1_000_000);

  if (inputPerM === null || outputPerM === null || groundedPerQuery === null) return fallback;

  return {
    model: typeof r.model === 'string' && r.model ? r.model : fallback.model,
    inputPerM,
    outputPerM,
    groundedPerQuery,
    groundedFreePerDay: groundedFreePerDay ?? fallback.groundedFreePerDay,
    source: typeof r.source === 'string' && r.source ? r.source : 'manual',
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : null,
  };
}

export async function currentRates(db: D1DatabaseCompat): Promise<AiRates> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rates;

  const fallback = defaultRates();
  let rates = fallback;
  try {
    const stored = await getSetting(db, SETTINGS.AI_RATES, '');
    if (stored) rates = parseRates(JSON.parse(stored), fallback);
  } catch {
    // A corrupt settings row must not stop the app pricing calls — the
    // built-in rates are stale at worst, and the admin page shows the source.
    rates = fallback;
  }

  cache = { at: Date.now(), rates };
  return rates;
}

export async function saveRates(
  db: D1DatabaseCompat,
  rates: Omit<AiRates, 'updatedAt'>,
  by: string
): Promise<AiRates> {
  const next: AiRates = { ...rates, updatedAt: new Date().toISOString() };
  await setSetting(db, SETTINGS.AI_RATES, JSON.stringify(next), by);
  clearRatesCache();
  return next;
}

/** The cost of one call at the given rates. Mirrors pricing.costOf. */
export function costAt(
  rates: AiRates,
  usage: { inputTokens: number; outputTokens: number; groundedQueries: number }
): number {
  return (
    (usage.inputTokens / 1_000_000) * rates.inputPerM +
    (usage.outputTokens / 1_000_000) * rates.outputPerM +
    usage.groundedQueries * rates.groundedPerQuery
  );
}

// ── Live lookup from Google's public price list ─────────────────────────────

export interface RateProposal {
  ok: boolean;
  /** What we found, when we found it confidently. */
  rates?: Pick<AiRates, 'inputPerM' | 'outputPerM'>;
  /** Always populated: what happened, in a sentence for the admin page. */
  message: string;
  /** The SKU descriptions considered, so a failed match can be diagnosed. */
  candidates?: string[];
}

const CATALOG = 'https://cloudbilling.googleapis.com/v1/services';

interface Sku {
  description?: string;
  category?: { resourceGroup?: string };
  pricingInfo?: Array<{
    pricingExpression?: {
      usageUnit?: string;
      usageUnitDescription?: string;
      baseUnitConversionFactor?: number;
      tieredRates?: Array<{ unitPrice?: { units?: string; nanos?: number } }>;
    };
  }>;
}

function skuUsdPerUnit(sku: Sku): number | null {
  const tier = sku.pricingInfo?.[0]?.pricingExpression?.tieredRates?.slice(-1)[0]?.unitPrice;
  if (!tier) return null;
  const units = Number(tier.units ?? 0);
  const nanos = Number(tier.nanos ?? 0);
  if (!Number.isFinite(units) || !Number.isFinite(nanos)) return null;
  return units + nanos / 1e9;
}

/**
 * Asks Google's Cloud Billing Catalog what this model costs today.
 *
 * Needs `GOOGLE_BILLING_API_KEY` (a plain API key with the Cloud Billing API
 * enabled). Returns a *proposal*, never a mutation: the catalog's SKU
 * descriptions are marketing text that changes, and their units differ between
 * SKUs (per token, per 1M tokens, per 1k characters). Matching is therefore
 * best-effort by design, and an uncertain result comes back as `ok: false`
 * with the candidate descriptions attached, so an admin can set the number by
 * hand from a list rather than hunting a pricing page.
 */
export async function refreshRatesFromGoogle(
  model = process.env.LLM_MODEL || 'gemini-2.5-flash',
  fetchImpl: typeof fetch = fetch
): Promise<RateProposal> {
  const key = process.env.GOOGLE_BILLING_API_KEY;
  if (!key) {
    return {
      ok: false,
      message:
        'Set GOOGLE_BILLING_API_KEY (an API key with the Cloud Billing API enabled) to look prices up automatically. Until then rates can be entered by hand.',
    };
  }

  try {
    const services = (await (
      await fetchImpl(`${CATALOG}?key=${encodeURIComponent(key)}&pageSize=200`)
    ).json()) as { services?: Array<{ name?: string; displayName?: string }> };

    const vertex = services.services?.find((s) => /vertex ai/i.test(s.displayName ?? ''));
    if (!vertex?.name) {
      return { ok: false, message: 'Could not find the Vertex AI service in the price catalog.' };
    }

    const skus = (await (
      await fetchImpl(`${CATALOG.replace('/services', '')}/${vertex.name}/skus?key=${encodeURIComponent(key)}&pageSize=2000`)
    ).json()) as { skus?: Sku[] };

    // "gemini-2.5-flash" is written "Gemini 2.5 Flash" in SKU descriptions.
    const words = model.replace(/[-_]/g, ' ').toLowerCase();
    const matching = (skus.skus ?? []).filter((s) =>
      words.split(' ').every((w) => (s.description ?? '').toLowerCase().includes(w))
    );

    const find = (kind: RegExp) =>
      matching.find((s) => kind.test(s.description ?? '') && skuUsdPerUnit(s) !== null);

    const input = find(/input/i);
    const output = find(/output/i);
    const candidates = matching.map((s) => s.description ?? '').slice(0, 20);

    if (!input || !output) {
      return {
        ok: false,
        message: `Found ${matching.length} SKUs for "${model}" but could not identify input and output prices. Set them by hand.`,
        candidates,
      };
    }

    // The catalog quotes these per token or per million; normalise on the unit
    // it declares rather than assuming, and refuse anything unrecognised.
    const perM = (sku: Sku): number | null => {
      const price = skuUsdPerUnit(sku);
      const unit = (
        sku.pricingInfo?.[0]?.pricingExpression?.usageUnitDescription ??
        sku.pricingInfo?.[0]?.pricingExpression?.usageUnit ??
        ''
      ).toLowerCase();
      if (price === null) return null;
      if (/million/.test(unit)) return price;
      if (/1k|thousand/.test(unit)) return price * 1000;
      if (/token|count/.test(unit)) return price * 1_000_000;
      return null;
    };

    const inputPerM = perM(input);
    const outputPerM = perM(output);
    if (inputPerM === null || outputPerM === null) {
      return {
        ok: false,
        message: 'Found the SKUs but could not read their pricing units. Set them by hand.',
        candidates,
      };
    }

    return {
      ok: true,
      rates: { inputPerM, outputPerM },
      message: `Read from Google's price catalog: $${inputPerM}/M input, $${outputPerM}/M output.`,
      candidates,
    };
  } catch (error) {
    return {
      ok: false,
      message: `Could not reach the price catalog: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }
}
