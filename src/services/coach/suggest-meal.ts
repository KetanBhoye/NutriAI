import { getGoogleAccessToken } from '../llm/google-auth.js';
import { vertexFetch, vertexUrl } from '../llm/vertex.js';
import { describeBand, mealCalorieBand, pickSuggestions, type MealType } from './meal-budget.js';

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

/**
 * Cuisine angles to rotate through, so repeated asks explore different corners
 * of everyday Indian food.
 *
 * The prompt used to name eight specific dishes as examples, and the model
 * returned those eight dishes — that is what "it only suggests the same 2-3
 * things" was. Naming a *region or style* instead steers without dictating,
 * and rotating it means "Suggest others" is a genuinely different question.
 */
const ANGLES = [
  'North Indian home cooking',
  'South Indian home cooking',
  'Bengali or eastern Indian home cooking',
  'Gujarati or Maharashtrian home cooking',
  'quick no-cook or assembly-only options',
  'high-protein vegetarian options',
  'street-food-style dishes made simply at home',
  'one-pot or single-pan dishes',
];

/** How many to ask for, before `pickSuggestions` chooses the best 3. */
const CANDIDATES = 6;

export async function generateMealSuggestions(opts: {
  remainingCalories: number | null;
  remainingProtein: number | null;
  mealType: string;
  dietNotes: string | null;
  /** Dishes to avoid: eaten today, or already shown and rejected. */
  avoid?: string[];
  credentialJson: string;
  project: string;
  location: string;
  model: string;
}): Promise<MealSuggestion[]> {
  const token = await getGoogleAccessToken(opts.credentialJson);
  const url = vertexUrl(opts.project, opts.location, opts.model);

  const mealType = (
    ['breakfast', 'lunch', 'dinner', 'snack'].includes(opts.mealType) ? opts.mealType : 'meal'
  ) as MealType;
  const band = mealCalorieBand({
    remainingCalories: opts.remainingCalories,
    remainingProtein: opts.remainingProtein,
    mealType,
  });

  const angle = ANGLES[Math.floor(Math.random() * ANGLES.length)]!;
  const avoid = (opts.avoid ?? []).filter(Boolean).slice(0, 25);

  const system = `You are an Indian nutrition coach suggesting what to eat RIGHT NOW for the user's ${mealType}.

- Suggest exactly ${CANDIDATES} DIFFERENT options. Each must be SIMPLE, common, everyday Indian home food or a quick easy recipe. NO fancy, restaurant-style, or complex multi-step recipes.
- ${describeBand(band, mealType)}
- Give realistic calories and macros for the portion you describe, and make the calories MATCH the portion — if the budget is small, suggest a smaller portion or a lighter dish rather than misreporting a large one.
- This time, lean towards: ${angle}. Vary the options — do not return ${CANDIDATES} versions of the same dish.
- "description": one short line — the key ingredients or a 1-line how-to. Keep it plain.
- Strictly honour the user's diet notes (e.g. vegetarian, no eggs, allergies):
${opts.dietNotes ? opts.dietNotes : '(none)'}
- Prefer high-protein, simple, affordable Indian choices.${
    avoid.length
      ? `\n- Do NOT suggest any of these, the user has already had or seen them today: ${avoid.join(', ')}.`
      : ''
  }`;

  const res = await vertexFetch(url, token, {
    system_instruction: { parts: [{ text: system }] },
    contents: [
      { role: 'user', parts: [{ text: `What are ${CANDIDATES} simple things I can eat for ${mealType}?` }] },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      // Higher than the old 0.6: at that setting an identical prompt returned
      // near-identical lists, so "Suggest others" showed the same food again.
      temperature: 1.0,
      // No deep reasoning needed for a structured list; thinking occasionally
      // runs away (30s+) and times the request out. Disabling it is fast + cheap.
      thinkingConfig: { thinkingBudget: 0 },
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

  const cleaned = (parsed.suggestions ?? []).map((s) => ({
    name: String(s.name ?? 'Meal').slice(0, 100),
    description: String(s.description ?? '').slice(0, 200),
    calories: clampInt(s.calories, 0, 3000),
    protein_g: clampInt(s.protein_g, 0, 300),
    carbs_g: clampInt(s.carbs_g, 0, 500),
    fat_g: clampInt(s.fat_g, 0, 300),
  }));

  // The band is enforced here, not just requested. The model drifts most at
  // exactly the extremes where fitting the budget matters — which is why the
  // old version felt the same whether 1,900 kcal were left or 300.
  return pickSuggestions(cleaned, band, 3);
}
