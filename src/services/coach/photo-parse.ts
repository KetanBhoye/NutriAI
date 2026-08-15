import { getGoogleAccessToken } from '../llm/google-auth.js';
import { vertexFetch, vertexUrl } from '../llm/vertex.js';
import { CONSERVATIVE_ESTIMATION_RULES, reconcileMacros } from './macro-sanity.js';

/**
 * Identifies the foods in a meal photo and estimates their portions and macros
 * via Vertex AI (Gemini multimodal). Returns items for the user to confirm —
 * nothing is logged here, since a vision estimate should never silently write to
 * the diary. Throws on failure so the caller can surface a friendly error.
 */
export interface PhotoItem {
  food_name: string;
  quantity: number;
  unit: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface PhotoResult {
  understood: boolean;
  note: string;
  items: PhotoItem[];
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    understood: { type: 'BOOLEAN' },
    note: { type: 'STRING' },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          food_name: { type: 'STRING' },
          quantity: { type: 'NUMBER' },
          unit: { type: 'STRING' },
          calories: { type: 'INTEGER' },
          protein_g: { type: 'NUMBER' },
          carbs_g: { type: 'NUMBER' },
          fat_g: { type: 'NUMBER' },
        },
        required: ['food_name', 'quantity', 'unit', 'calories', 'protein_g', 'carbs_g', 'fat_g'],
      },
    },
  },
  required: ['understood', 'note', 'items'],
} as const;

const clampNum = (n: unknown, lo: number, hi: number) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
};

export async function parseMealPhoto(opts: {
  imageBase64: string;
  mimeType: string;
  knownFoods: string;
  credentialJson: string;
  project: string;
  location: string;
  model: string;
}): Promise<PhotoResult> {
  const token = await getGoogleAccessToken(opts.credentialJson);
  const url = vertexUrl(opts.project, opts.location, opts.model);

  const system = `You are a nutrition expert reading a photo of a meal to log it in a food tracker.

- Identify each DISTINCT food/drink you can see. One item per food.
- Estimate a realistic portion for each: use natural units the user would recognise ("bowl", "piece", "roti", "glass", "g", "cup"). quantity is a number, unit is the word.
- Give realistic calories and macros for that portion. This user eats mostly Indian home-cooked food; use that context for dishes like dal, sabzi, roti, rice, paneer, curd.
- Prefer the user's known foods and their values when a dish clearly matches one:
${opts.knownFoods || '(none yet)'}

${CONSERVATIVE_ESTIMATION_RULES}
- Write "note" as a short one-line description of the plate (e.g. "Veg thali: 2 roti, dal, aloo sabzi, rice, curd").
- If the image is NOT food, set understood=false and items=[].
- Be decisive; give your best estimate rather than refusing. Portions are approximate and the user will confirm them.`;

  // Images are larger; give each attempt more time but keep the retry.
  const res = await vertexFetch(
    url,
    token,
    {
      system_instruction: { parts: [{ text: system }] },
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: opts.mimeType, data: opts.imageBase64 } },
            { text: 'Identify every food in this meal and estimate portions and macros to log it.' },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.2,
        thinkingConfig: { thinkingBudget: 0 },
      },
    },
    { timeoutMs: 35_000, retries: 1 }
  );

  if (!res.ok) {
    throw new Error(`Vertex photo request failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Vertex photo response was empty');
  const parsed = JSON.parse(text) as PhotoResult;

  return {
    understood: Boolean(parsed.understood),
    note: String(parsed.note ?? '').slice(0, 200),
    items: (parsed.items ?? []).slice(0, 12).map((it) => {
      // The prompt asks for consistent numbers; this makes sure of it, since a
      // photo estimate is the easiest place to inflate protein unnoticed.
      const macros = reconcileMacros({
        calories: clampNum(it.calories, 0, 5000),
        protein_g: clampNum(it.protein_g, 0, 400),
        carbs_g: clampNum(it.carbs_g, 0, 800),
        fat_g: clampNum(it.fat_g, 0, 400),
      });
      return {
        food_name: String(it.food_name ?? 'Food').slice(0, 120),
        quantity: clampNum(it.quantity, 0.1, 100),
        unit: String(it.unit ?? 'serving').slice(0, 20),
        calories: Math.round(macros.calories),
        protein_g: Math.round(macros.protein_g),
        carbs_g: Math.round(macros.carbs_g),
        fat_g: Math.round(macros.fat_g),
      };
    }),
  };
}
