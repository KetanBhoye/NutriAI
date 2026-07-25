import { getGoogleAccessToken } from '../llm/google-auth.js';

/**
 * Generates a personalised nutrition plan for a new user via Vertex AI, using
 * their profile and chosen goal. The returned `summary` is durable coaching
 * context: it is stored in the user's preferences (behavior_instructions) so
 * the Coach grounds every later reply in the same plan.
 *
 * The client already computes sensible baseline targets; this refines them and
 * writes the human-readable rationale. Callers fall back to the baseline if
 * this throws, so onboarding never blocks on the AI.
 */
export interface OnboardingPlanInput {
  display_name?: string;
  gender: 'male' | 'female';
  age: number;
  height_cm: number;
  weight_kg: number;
  activity_level: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
  goal: 'cut' | 'maintain' | 'lean_bulk' | 'bulk';
  target_weight_kg?: number | null;
  target_rate_kg_per_week?: number | null;
  bmr: number;
  tdee: number;
  baseline: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
  credentialJson: string;
  project: string;
  location: string;
  model: string;
}

export interface OnboardingPlan {
  daily_calorie_goal: number;
  daily_protein_goal_g: number;
  daily_carbs_goal_g: number;
  daily_fat_goal_g: number;
  summary: string;
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    daily_calorie_goal: { type: 'INTEGER' },
    daily_protein_goal_g: { type: 'INTEGER' },
    daily_carbs_goal_g: { type: 'INTEGER' },
    daily_fat_goal_g: { type: 'INTEGER' },
    summary: { type: 'STRING' },
  },
  required: [
    'daily_calorie_goal',
    'daily_protein_goal_g',
    'daily_carbs_goal_g',
    'daily_fat_goal_g',
    'summary',
  ],
} as const;

const GOAL_LABEL: Record<OnboardingPlanInput['goal'], string> = {
  cut: 'fat loss (calorie deficit, preserve muscle)',
  maintain: 'maintenance / body recomposition',
  lean_bulk: 'lean muscle gain (small surplus)',
  bulk: 'muscle & strength gain (larger surplus)',
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));

export async function generateOnboardingPlan(input: OnboardingPlanInput): Promise<OnboardingPlan> {
  const token = await getGoogleAccessToken(input.credentialJson);
  const url =
    `https://${input.location}-aiplatform.googleapis.com/v1/projects/${input.project}` +
    `/locations/${input.location}/publishers/google/models/${encodeURIComponent(input.model)}:generateContent`;

  const system = `You are a certified nutrition and strength coach setting up a new client in a calorie-tracking app. Given their stats and goal, produce daily targets and a short, durable coaching note.

Rules:
- If a target_weekly_rate_kg is given, size the calorie target from it: deficit/surplus ≈ rate × 7700 ÷ 7 kcal/day (e.g. 0.5 kg/week ≈ 550 kcal/day). Otherwise a cut is roughly a 15–25% deficit; a lean bulk a 5–10% surplus; a bulk a 10–20% surplus; maintenance stays near TDEE. Never go below their BMR for calories.
- Protein: 1.6–2.2 g per kg bodyweight (higher for a cut). Fat: 20–30% of calories. Carbohydrates: fill the remainder. protein*4 + carbs*4 + fat*9 should be within ~5% of the calorie target.
- Keep numbers realistic and round to tidy values.
- The user eats mostly Indian home-cooked food.

Write "summary" in 2–4 sentences as notes ABOUT this user that the coach should remember: their goal, their maintenance, their daily targets, and 2–3 concrete guidelines (e.g. how to prioritise protein, how much daily deficit/surplus, expected weekly rate). This text is saved and read on every future coaching turn, so make it specific and useful.`;

  const userMsg = JSON.stringify({
    name: input.display_name ?? null,
    gender: input.gender,
    age: input.age,
    height_cm: input.height_cm,
    current_weight_kg: input.weight_kg,
    target_weight_kg: input.target_weight_kg ?? null,
    activity_level: input.activity_level,
    goal: GOAL_LABEL[input.goal],
    target_weekly_rate_kg: input.target_rate_kg_per_week ?? null,
    bmr_kcal: input.bmr,
    maintenance_tdee_kcal: input.tdee,
    app_computed_baseline: input.baseline,
  });

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: userMsg }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.4,
        },
      }),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw new Error(`Vertex plan request failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Vertex plan response was empty');
  const parsed = JSON.parse(text) as OnboardingPlan;

  // Guard against an out-of-range model response — never below BMR, never absurd.
  return {
    daily_calorie_goal: clamp(parsed.daily_calorie_goal, Math.min(input.bmr, 1000), 8000),
    daily_protein_goal_g: clamp(parsed.daily_protein_goal_g, 0, 500),
    daily_carbs_goal_g: clamp(parsed.daily_carbs_goal_g, 0, 1000),
    daily_fat_goal_g: clamp(parsed.daily_fat_goal_g, 0, 500),
    summary: String(parsed.summary ?? '').slice(0, 1500),
  };
}
