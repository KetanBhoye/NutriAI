import { AnthropicProvider } from './anthropic-provider.js';
import { GeminiProvider } from './gemini-provider.js';
import { OpenAiProvider } from './openai-provider.js';
import { VertexProvider } from './vertex-provider.js';
import {
  parseResultSchema,
  type LlmProvider,
  type ParseContext,
  type ParseResult,
} from './types.js';

export type { LlmProvider, ParseContext, ParseResult } from './types.js';

/**
 * Selects a provider from environment configuration:
 *   LLM_PROVIDER   anthropic (default) | openai | gemini
 *   ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY
 *   LLM_MODEL      optional model override for the chosen provider
 *
 * Returns null when no key is configured, so the AI endpoint can report the
 * feature as unconfigured rather than throwing.
 */
export function createProviderFromEnv(): LlmProvider | null {
  const provider = (process.env.LLM_PROVIDER || 'anthropic').toLowerCase();
  const model = process.env.LLM_MODEL;

  if (provider === 'openai') {
    const key = process.env.OPENAI_API_KEY;
    return key ? new OpenAiProvider(key, model) : null;
  }

  if (provider === 'gemini' || provider === 'google') {
    const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    return key ? new GeminiProvider(key, model) : null;
  }

  if (provider === 'vertex') {
    const sa = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    return sa
      ? new VertexProvider({
          serviceAccountJson: sa,
          project: process.env.GCP_PROJECT,
          location: process.env.GCP_LOCATION,
          model,
        })
      : null;
  }

  const key = process.env.ANTHROPIC_API_KEY;
  return key ? new AnthropicProvider(key, model) : null;
}

export interface FoodLogParse extends ParseResult {
  provider: string;
}

/**
 * Runs the provider and validates its output against the strict schema.
 *
 * This validation is the safety boundary: an LLM can hallucinate an
 * implausible number or a malformed shape, and nothing it returns should reach
 * the food log without passing these bounds. A validation failure surfaces as
 * a clarification rather than a thrown error, so the user sees "I couldn't read
 * that" instead of a 500.
 */
export async function parseFoodLog(
  provider: LlmProvider,
  userMessage: string,
  context: ParseContext
): Promise<FoodLogParse> {
  const raw = await provider.parseFoodLog(userMessage, context);
  const result = parseResultSchema.safeParse(raw);

  if (!result.success) {
    return {
      provider: provider.name,
      understood: false,
      clarification:
        "I couldn't turn that into a food entry. Try naming the food and roughly how much, e.g. \"2 chapatis and a bowl of dal\".",
      entry_date: context.today,
      items: [],
    };
  }

  return { provider: provider.name, ...result.data };
}
