import { getGoogleAccessToken } from '../llm/google-auth.js';
import { vertexFetch, vertexUrl } from '../llm/vertex.js';
import { CONSERVATIVE_ESTIMATION_RULES, reconcileMacros } from './macro-sanity.js';

/**
 * Looks up accurate, web-sourced macros for foods using Gemini with Google
 * Search grounding — so logged calories/macros come from real nutrition data
 * rather than the model's memory. Grounding can't be combined with a JSON
 * responseSchema, so we prompt for JSON and parse it out of the text.
 */
export interface GroundedMacroItem {
  name: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export async function lookupMacrosGrounded(
  query: string
): Promise<{ items: GroundedMacroItem[]; sources: string[] }> {
  const credentialJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const project = process.env.GCP_PROJECT;
  if (!credentialJson || !project) throw new Error('Vertex AI not configured');

  const location = process.env.GCP_LOCATION || 'us-central1';
  const model = process.env.LLM_MODEL || 'gemini-2.5-flash';
  const token = await getGoogleAccessToken(credentialJson);
  const url = vertexUrl(project, location, model);

  const prompt =
    `Search the web for accurate nutrition facts for exactly these foods and portions: ${query}. ` +
    `The user eats mostly Indian home-cooked food, so use realistic values for Indian preparations. ` +
    `Give values for the portion stated, not per 100 g — converting when the source is per 100 g. ` +
    `\n\n${CONSERVATIVE_ESTIMATION_RULES}\n\n` +
    `Return ONLY a JSON object (no prose, no markdown fences): ` +
    `{"items":[{"name":"food with portion","calories":0,"protein_g":0,"carbs_g":0,"fat_g":0}]} ` +
    `with realistic INTEGER per-portion values for each item mentioned.`;

  const res = await vertexFetch(
    url,
    token,
    {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{ googleSearch: {} }],
    },
    { timeoutMs: 30_000, retries: 1 }
  );
  if (!res.ok) {
    throw new Error(`Grounded lookup failed (${res.status}): ${(await res.text()).slice(0, 160)}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> };
    }>;
  };
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  const parsed = JSON.parse(extractJson(text)) as { items?: GroundedMacroItem[] };

  const num = (v: unknown) => Math.max(0, Math.round(Number(v) || 0));
  const sources = (cand?.groundingMetadata?.groundingChunks ?? [])
    .map((c) => c.web?.title || c.web?.uri || '')
    .filter(Boolean)
    .slice(0, 4);

  return {
    items: (parsed.items ?? []).slice(0, 12).map((i) => {
      // Web sources mix per-100 g and per-serving figures freely, which is the
      // usual way an item comes back carrying more macro energy than calories.
      const macros = reconcileMacros({
        calories: num(i.calories),
        protein_g: num(i.protein_g),
        carbs_g: num(i.carbs_g),
        fat_g: num(i.fat_g),
      });
      return {
        name: String(i.name ?? 'Food').slice(0, 120),
        calories: Math.round(macros.calories),
        protein_g: Math.round(macros.protein_g),
        carbs_g: Math.round(macros.carbs_g),
        fat_g: Math.round(macros.fat_g),
      };
    }),
    sources,
  };
}

/** Pulls a JSON object out of a possibly fenced / prose-wrapped model reply. */
function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  const brace = text.match(/\{[\s\S]*\}/);
  return brace ? brace[0] : text;
}
