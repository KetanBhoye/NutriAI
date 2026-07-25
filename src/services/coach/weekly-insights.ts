import { getGoogleAccessToken } from '../llm/google-auth.js';

/**
 * Generates a weekly insight report from the user's computed stats via Vertex
 * AI. Stats are calculated deterministically by the caller; the model only
 * writes the human-readable analysis (a headline, a short summary, wins, and
 * focus areas). Throws on failure so the caller can fall back to a rule-based
 * report and never blocks the Trends tab.
 */
export interface WeeklyStats {
  days_logged: number;
  avg_calories: number | null;
  calorie_goal: number | null;
  avg_protein_g: number | null;
  protein_goal_g: number | null;
  avg_steps: number | null;
  step_goal: number | null;
  weight_change_kg: number | null; // over the window; negative = lost
  weight_goal_direction: 'lose' | 'gain' | 'maintain' | null;
  estimated_weekly_deficit_kcal: number | null; // total, from TDEE if known
  diet_notes: string | null;
}

export interface WeeklyReport {
  headline: string;
  summary: string;
  wins: string[];
  focus: string[];
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    headline: { type: 'STRING' },
    summary: { type: 'STRING' },
    wins: { type: 'ARRAY', items: { type: 'STRING' } },
    focus: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['headline', 'summary', 'wins', 'focus'],
} as const;

export async function generateWeeklyInsights(input: {
  displayName: string | null;
  stats: WeeklyStats;
  credentialJson: string;
  project: string;
  location: string;
  model: string;
}): Promise<WeeklyReport> {
  const token = await getGoogleAccessToken(input.credentialJson);
  const url =
    `https://${input.location}-aiplatform.googleapis.com/v1/projects/${input.project}` +
    `/locations/${input.location}/publishers/google/models/${encodeURIComponent(input.model)}:generateContent`;

  const system = `You are a supportive but honest nutrition and fitness coach writing a short weekly check-in for your client based on their logged data.

Rules:
- Ground every statement in the numbers provided — never invent data. If a metric is null, don't discuss it.
- "headline": one upbeat but truthful line (max ~8 words), e.g. "Solid week — protein on point".
- "summary": 2–4 sentences on how the week went overall — consistency of logging, calories vs their goal, protein, steps, and any weight movement, and whether that lines up with their goal direction.
- "wins": 1–3 specific things they did well (short phrases).
- "focus": 1–3 concrete, actionable things to improve next week (short phrases). Be specific and realistic; respect any diet notes.
- Be encouraging, concise, and personal. Use "you". No markdown, no emojis.`;

  const userMsg = JSON.stringify({ name: input.displayName, ...input.stats });

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
          temperature: 0.5,
        },
      }),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw new Error(`Vertex insights failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Vertex insights response was empty');
  const parsed = JSON.parse(text) as WeeklyReport;
  return {
    headline: String(parsed.headline ?? '').slice(0, 120),
    summary: String(parsed.summary ?? '').slice(0, 1200),
    wins: (parsed.wins ?? []).slice(0, 4).map((w) => String(w).slice(0, 160)),
    focus: (parsed.focus ?? []).slice(0, 4).map((f) => String(f).slice(0, 160)),
  };
}
