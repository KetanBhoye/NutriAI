import { buildSystemPrompt, type LlmProvider, type ParseContext } from './types.js';

/**
 * Google Gemini parser (Gemini Developer API), behind the same LlmProvider
 * interface as the others — so LLM_PROVIDER=gemini is a config switch.
 *
 * Uses an API key rather than Vertex service-account auth, which keeps
 * deployment to a single env var. To have usage draw from a Google Cloud
 * billing credit, create the key in a Cloud project with billing enabled.
 *
 * Model defaults to gemini-2.5-flash — cheap and fast, ideal for this
 * extraction task — and is overridable with LLM_MODEL.
 */
export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    this.model = model || 'gemini-2.5-flash';
  }

  async parseFoodLog(userMessage: string, context: ParseContext): Promise<unknown> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      this.model
    )}:generateContent`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: buildSystemPrompt(context) }] },
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: GEMINI_RESPONSE_SCHEMA,
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Gemini request failed (${response.status}): ${detail.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
      promptFeedback?: { blockReason?: string };
    };

    if (data.promptFeedback?.blockReason) {
      throw new Error(`Gemini blocked the request: ${data.promptFeedback.blockReason}`);
    }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('Gemini response contained no content');
    }
    return JSON.parse(text);
  }
}

/**
 * Gemini uses its own schema dialect (uppercase types, `nullable`, no
 * `additionalProperties`), so the parse schema is expressed here in that form.
 * The server still re-validates every response against the strict Zod schema,
 * so this only needs to steer the model, not enforce correctness.
 */
const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    understood: { type: 'BOOLEAN' },
    clarification: { type: 'STRING', nullable: true },
    entry_date: { type: 'STRING' },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          food_name: { type: 'STRING' },
          quantity: { type: 'NUMBER' },
          unit: { type: 'STRING' },
          meal_type: { type: 'STRING', enum: ['breakfast', 'lunch', 'dinner', 'snack'] },
          calories: { type: 'NUMBER' },
          protein_g: { type: 'NUMBER' },
          carbs_g: { type: 'NUMBER' },
          fat_g: { type: 'NUMBER' },
        },
        required: [
          'food_name',
          'quantity',
          'unit',
          'meal_type',
          'calories',
          'protein_g',
          'carbs_g',
          'fat_g',
        ],
      },
    },
  },
  required: ['understood', 'clarification', 'entry_date', 'items'],
} as const;
