import { getGoogleAccessToken } from '../llm/google-auth.js';
import { vertexFetch, vertexUrl } from '../llm/vertex.js';

/**
 * Suggests what to eat next: a few SIMPLE Indian home-style meals/snacks that
 * fit the calories left in the day and help hit the protein target, honouring
 * the user's diet notes. Deliberately keeps ideas quick and everyday — no fancy
 * or complex recipes.
 */
export interface MealSuggestion {
  name: string;
  description: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    suggestions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          description: { type: 'STRING' },
          calories: { type: 'INTEGER' },
          protein_g: { type: 'INTEGER' },
          carbs_g: { type: 'INTEGER' },
          fat_g: { type: 'INTEGER' },
        },
        required: ['name', 'description', 'calories', 'protein_g', 'carbs_g', 'fat_g'],
      },
    },
  },
  required: ['suggestions'],
} as const;

const clampInt = (n: unknown, lo: number, hi: number) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
};

export async function generateMealSuggestions(opts: {
  remainingCalories: number | null;
  remainingProtein: number | null;
  mealType: string;
  dietNotes: string | null;
  credentialJson: string;
  project: string;
  location: string;
  model: string;
}): Promise<MealSuggestion[]> {
  const token = await getGoogleAccessToken(opts.credentialJson);
  const url = vertexUrl(opts.project, opts.location, opts.model);

  const budget =
    opts.remainingCalories != null
      ? `They have about ${opts.remainingCalories} kcal left today${
          opts.remainingProtein != null && opts.remainingProtein > 0
            ? ` and still need ~${opts.remainingProtein}g protein`
            : ''
        }.`
      : 'Suggest a balanced option.';

  const system = `You are an Indian nutrition coach suggesting what to eat RIGHT NOW for the user's ${opts.mealType}.

- Suggest exactly 3 options. Each must be SIMPLE, common, everyday Indian home food or a quick easy recipe (e.g. moong dal chilla, curd rice, paneer bhurji with roti, sprouts chaat, boiled eggs with toast, dahi + chana, poha, upma). NO fancy, restaurant-style, or complex multi-step recipes.
- Each option should roughly fit the calories left and help with protein. ${budget}
- "description": one short line — the key ingredients or a 1-line how-to. Keep it plain.
- Give realistic calories and macros for a normal single portion.
- Strictly honour the user's diet notes (e.g. vegetarian, no eggs, allergies):
${opts.dietNotes ? opts.dietNotes : '(none)'}
- Prefer high-protein, simple, affordable Indian choices.`;

  const res = await vertexFetch(url, token, {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: `What are 3 simple things I can eat for ${opts.mealType}?` }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.6,
    },
  });

  if (!res.ok) {
    throw new Error(`Vertex suggest failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Vertex suggest response was empty');
  const parsed = JSON.parse(text) as { suggestions: MealSuggestion[] };

  return (parsed.suggestions ?? []).slice(0, 3).map((s) => ({
    name: String(s.name ?? 'Meal').slice(0, 100),
    description: String(s.description ?? '').slice(0, 200),
    calories: clampInt(s.calories, 0, 3000),
    protein_g: clampInt(s.protein_g, 0, 300),
    carbs_g: clampInt(s.carbs_g, 0, 500),
    fat_g: clampInt(s.fat_g, 0, 300),
  }));
}
