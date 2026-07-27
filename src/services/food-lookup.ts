/**
 * External food lookup for foods with no logging history.
 *
 * Open Food Facts is the primary source: free, no API key, and strong on
 * packaged/barcoded products (protein bars, whey, soft drinks). It is weak on
 * composed home-cooked dishes, which is most of this user's diet — so results
 * are offered as candidates to confirm, never written automatically.
 *
 * USDA FoodData Central is the fallback for generic ingredients. It needs a
 * free API key; without FDC_API_KEY set, that source is simply skipped.
 */

export interface LookupResult {
  name: string;
  brand: string | null;
  /**
   * True when the entry's own numbers don't add up. Open Food Facts is
   * crowd-sourced and contains real errors (a flaked-rice product listing 722
   * kcal/100g, which is physically impossible). Suspect results are still
   * returned — the user may recognise the right one — but the UI must warn
   * rather than let a bad value into the library unremarked.
   */
  suspect: boolean;
  /** Macros are always normalised to per-gram, matching the library's units. */
  calories_per_unit: number;
  protein_g_per_unit: number | null;
  carbs_g_per_unit: number | null;
  fat_g_per_unit: number | null;
  reference_unit: 'g';
  default_quantity: number;
  source: 'openfoodfacts' | 'usda';
  source_ref: string | null;
}

const TIMEOUT_MS = 6000;
const OFF_ENDPOINT = 'https://world.openfoodfacts.org/cgi/search.pl';
const USDA_ENDPOINT = 'https://api.nal.usda.gov/fdc/v1/foods/search';

async function fetchJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Open Food Facts asks clients to identify themselves.
        'User-Agent': 'NutriAI-Tracker/1.0 (personal calorie tracker)',
      },
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    // Timeouts and network failures degrade to "no results" rather than
    // failing the request — the user can still add the food manually.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function isUsableNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Pure fat is ~9 kcal/g, so nothing edible exceeds it. */
const MAX_KCAL_PER_GRAM = 9.1;

/**
 * Flags entries whose macros don't reconcile with their stated calories using
 * the 4/4/9 rule. Only applied when all three macros are present — a missing
 * macro is unknown, not wrong.
 */
function looksSuspect(
  kcalPerGram: number,
  protein: number | null,
  carbs: number | null,
  fat: number | null
): boolean {
  if (kcalPerGram > MAX_KCAL_PER_GRAM) return true;
  if (protein === null || carbs === null || fat === null) return false;

  const derived = protein * 4 + carbs * 4 + fat * 9;
  if (derived === 0) return kcalPerGram > 0.5;

  return Math.abs(kcalPerGram - derived) / Math.max(derived, 0.01) > 0.3;
}

interface OffProduct {
  product_name?: string;
  brands?: string;
  code?: string;
  nutriments?: Record<string, unknown>;
}

export function normalizeOpenFoodFacts(products: OffProduct[]): LookupResult[] {
  const results: LookupResult[] = [];

  for (const product of products) {
    const name = product.product_name?.trim();
    const nutriments = product.nutriments ?? {};
    // OFF reports energy in kJ under energy_100g on many products; the kcal
    // field is the one we want and is not always present.
    const kcalPer100g = nutriments['energy-kcal_100g'];

    if (!name || !isUsableNumber(kcalPer100g) || kcalPer100g === 0) continue;

    const perGram = (value: unknown): number | null =>
      isUsableNumber(value) ? value / 100 : null;

    const caloriesPerGram = kcalPer100g / 100;
    const protein = perGram(nutriments.proteins_100g);
    const carbs = perGram(nutriments.carbohydrates_100g);
    const fat = perGram(nutriments.fat_100g);

    results.push({
      name,
      brand: product.brands?.split(',')[0]?.trim() || null,
      suspect: looksSuspect(caloriesPerGram, protein, carbs, fat),
      calories_per_unit: caloriesPerGram,
      protein_g_per_unit: protein,
      carbs_g_per_unit: carbs,
      fat_g_per_unit: fat,
      reference_unit: 'g',
      default_quantity: 100,
      source: 'openfoodfacts',
      source_ref: product.code ?? null,
    });
  }

  return results;
}

interface UsdaFood {
  description?: string;
  fdcId?: number;
  brandName?: string;
  foodNutrients?: Array<{ nutrientName?: string; value?: number; unitName?: string }>;
}

export function normalizeUsda(foods: UsdaFood[]): LookupResult[] {
  const results: LookupResult[] = [];

  for (const food of foods) {
    const name = food.description?.trim();
    if (!name) continue;

    // USDA search results report nutrients per 100g.
    const find = (needle: string): number | null => {
      const match = food.foodNutrients?.find((nutrient) =>
        nutrient.nutrientName?.toLowerCase().startsWith(needle)
      );
      return isUsableNumber(match?.value) ? match!.value! : null;
    };

    const kcal = find('energy');
    if (kcal === null || kcal === 0) continue;

    const perGram = (value: number | null) => (value === null ? null : value / 100);

    const caloriesPerGram = kcal / 100;
    const protein = perGram(find('protein'));
    const carbs = perGram(find('carbohydrate'));
    const fat = perGram(find('total lipid'));

    results.push({
      name,
      brand: food.brandName?.trim() || null,
      suspect: looksSuspect(caloriesPerGram, protein, carbs, fat),
      calories_per_unit: caloriesPerGram,
      protein_g_per_unit: protein,
      carbs_g_per_unit: carbs,
      fat_g_per_unit: fat,
      reference_unit: 'g',
      default_quantity: 100,
      source: 'usda',
      source_ref: food.fdcId ? String(food.fdcId) : null,
    });
  }

  return results;
}

/**
 * Searches Open Food Facts first, then USDA only if OFF returned nothing.
 * Never throws: an unreachable provider yields fewer results, not an error.
 */
export async function lookupFood(query: string, limit = 8): Promise<LookupResult[]> {
  const term = query.trim();
  if (term.length < 2) return [];

  const offUrl =
    `${OFF_ENDPOINT}?search_terms=${encodeURIComponent(term)}` +
    `&search_simple=1&action=process&json=1&page_size=${limit}` +
    '&fields=product_name,brands,code,nutriments';

  const off = await fetchJson<{ products?: OffProduct[] }>(offUrl);
  const offResults = normalizeOpenFoodFacts(off?.products ?? []).slice(0, limit);
  if (offResults.length > 0) return offResults;

  const apiKey = process.env.FDC_API_KEY;
  if (!apiKey) return [];

  const usdaUrl =
    `${USDA_ENDPOINT}?api_key=${encodeURIComponent(apiKey)}` +
    `&query=${encodeURIComponent(term)}&pageSize=${limit}`;

  const usda = await fetchJson<{ foods?: UsdaFood[] }>(usdaUrl);
  return normalizeUsda(usda?.foods ?? []).slice(0, limit);
}

// ── Barcode lookup (Open Food Facts) ────────────────────────────────────────
export interface BarcodeProduct {
  found: boolean;
  code: string;
  name: string;
  brand: string | null;
  serving_g: number | null;
  per_100g: { calories: number; protein_g: number; carbs_g: number; fat_g: number } | null;
}

interface OffProductResponse {
  status?: number;
  product?: {
    product_name?: string;
    brands?: string;
    serving_quantity?: number | string;
    nutriments?: Record<string, number | string | undefined>;
  };
}

/** Looks up a packaged product by its barcode via Open Food Facts. */
export async function lookupBarcode(code: string): Promise<BarcodeProduct> {
  const url =
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json` +
    `?fields=product_name,brands,serving_quantity,nutriments`;
  const data = await fetchJson<OffProductResponse>(url);
  const p = data?.product;
  if (!data || data.status === 0 || !p) {
    return { found: false, code, name: '', brand: null, serving_g: null, per_100g: null };
  }

  const n = p.nutriments ?? {};
  const num = (v: unknown): number | null => {
    const x = Number(v);
    return Number.isFinite(x) && x >= 0 ? x : null;
  };
  const kcal = num(n['energy-kcal_100g']) ?? (num(n['energy_100g']) !== null ? num(n['energy_100g'])! / 4.184 : null);
  const per100 =
    kcal !== null
      ? {
          calories: Math.round(kcal),
          protein_g: Math.round(num(n['proteins_100g']) ?? 0),
          carbs_g: Math.round(num(n['carbohydrates_100g']) ?? 0),
          fat_g: Math.round(num(n['fat_100g']) ?? 0),
        }
      : null;

  return {
    found: Boolean(p.product_name && per100),
    code,
    name: p.product_name ?? 'Unknown product',
    brand: p.brands ?? null,
    serving_g: num(p.serving_quantity),
    per_100g: per100,
  };
}
