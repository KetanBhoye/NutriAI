import { getGoogleAccessToken } from '../llm/google-auth.js';
import { vertexFetch, vertexUrl } from '../llm/vertex.js';
import { CONSERVATIVE_ESTIMATION_RULES, reconcileMacros } from './macro-sanity.js';

/**
 * Looks up accurate, web-sourced macros for foods using Gemini with Google
 * Search grounding — so logged calories/macros come from real nutrition data
 * rather than the model's memory.
 *
 * Done in **two calls**, and the reason matters.
 *
 * Grounding cannot be combined with a JSON `responseSchema`, so the obvious
 * shortcut is to keep one grounded call and order it to emit only JSON. That
 * is what this used to do, and it quietly destroyed the feature: the model
 * still ran the searches, but a bare JSON object gives the grounding system
 * no prose to attach citations to, so `groundingChunks` came back **empty
 * every time**. `sources` was therefore always `[]`, and the numbers were the
 * model's own — the exact behaviour the tool exists to replace — while still
 * being metered and billed as a grounded query.
 *
 * Measured against production's own prompt, asking for one branded product:
 *
 *   as shipped ................................ 0 chunks (2 searches ran)
 *   same prompt without the JSON instruction ... 4 chunks
 *
 * So the search happens either way; only the evidence disappears. Splitting
 * the two jobs keeps both: call one reads the web and answers in prose, which
 * is what produces real citations, and call two — cheap, ungrounded, no
 * search — turns that prose into numbers. The second call is told to use only
 * what the first found, so it cannot reintroduce guesses.
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

  /**
   * Call one: read the web and answer in prose.
   *
   * No JSON instruction anywhere — that is the whole point. The model is
   * asked to state its figures and say where each came from, which is the
   * shape of answer grounding can actually cite.
   */
  const researchPrompt =
    `Search the web for accurate nutrition facts for exactly these foods and portions: ${query}. ` +
    `The user eats mostly Indian home-cooked food, so use realistic values for Indian preparations. ` +
    `Give values for the portion stated, not per 100 g — converting when the source is per 100 g. ` +
    `\n\n${CONSERVATIVE_ESTIMATION_RULES}\n\n` +
    `For each food give calories, protein, carbohydrate and fat for the stated portion, ` +
    `and say which source each figure came from. If the web gives nothing usable for an item, ` +
    `say so plainly for that item rather than inventing a source.`;

  const research = await vertexFetch(
    url,
    token,
    {
      contents: [{ role: 'user', parts: [{ text: researchPrompt }] }],
      tools: [{ googleSearch: {} }],
    },
    /**
     * Longer than the old single call allowed. Searching the web and writing
     * the findings out in prose is genuinely slower than emitting a small
     * JSON object from memory — which is the honest cost of actually doing
     * the lookup. 30s aborted often enough to matter.
     */
    { timeoutMs: 45_000, retries: 1 }
  );
  if (!research.ok) {
    throw new Error(
      `Grounded lookup failed (${research.status}): ${(await research.text()).slice(0, 160)}`
    );
  }

  const researchData = (await research.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> };
    }>;
  };
  const researchCand = researchData.candidates?.[0];
  const findings = (researchCand?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
  if (!findings) throw new Error('Grounded lookup returned nothing to read');

  const sources = dedupe(
    (researchCand?.groundingMetadata?.groundingChunks ?? [])
      .map((c) => c.web?.title || c.web?.uri || '')
      .filter(Boolean)
  ).slice(0, 6);

  /**
   * Call two: turn that prose into numbers.
   *
   * Ungrounded and search-free, so it is cheap and cannot wander off to look
   * something up on its own — it may only transcribe what call one found.
   * With no grounding in play, a `responseSchema` is allowed, which removes
   * the fenced-JSON parsing that used to be needed.
   */
  const extract = await vertexFetch(
    url,
    token,
    {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text:
                `Convert these nutrition findings into structured data. Use ONLY the figures ` +
                `stated below — do not adjust them, and do not add any food that is not ` +
                `mentioned. Give integer values for the portion described.\n\n${findings}`,
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            items: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  name: { type: 'STRING' },
                  calories: { type: 'NUMBER' },
                  protein_g: { type: 'NUMBER' },
                  carbs_g: { type: 'NUMBER' },
                  fat_g: { type: 'NUMBER' },
                },
                required: ['name', 'calories', 'protein_g', 'carbs_g', 'fat_g'],
              },
            },
          },
          required: ['items'],
        },
      },
    },
    { timeoutMs: 20_000, retries: 1 }
  );
  if (!extract.ok) {
    throw new Error(
      `Macro extraction failed (${extract.status}): ${(await extract.text()).slice(0, 160)}`
    );
  }

  const extractData = (await extract.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = (extractData.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('');
  const parsed = JSON.parse(extractJson(text)) as { items?: GroundedMacroItem[] };

  const num = (v: unknown) => Math.max(0, Math.round(Number(v) || 0));
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

/** The same source can back several figures; show each site once. */
function dedupe(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

/**
 * Pulls a JSON object out of a possibly fenced / prose-wrapped model reply.
 *
 * The extraction call asks for `application/json`, so this is belt and
 * braces — but a schema-constrained reply has still been seen fenced.
 */
function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  const brace = text.match(/\{[\s\S]*\}/);
  return brace ? brace[0] : text;
}
