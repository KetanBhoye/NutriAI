import { buildSystemPrompt, PARSE_JSON_SCHEMA, type LlmProvider, type ParseContext } from './types.js';

/**
 * OpenAI-backed parser behind the same interface as the Anthropic one, so the
 * provider is a config switch (LLM_PROVIDER=openai) and not a code change
 * elsewhere. Uses the Chat Completions API with a json_schema response format.
 *
 * Implemented with fetch rather than the OpenAI SDK to keep the dependency
 * surface small — the request shape here is stable.
 */
export class OpenAiProvider implements LlmProvider {
  readonly name = 'openai';
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    this.model = model || 'gpt-4o-mini';
  }

  async parseFoodLog(userMessage: string, context: ParseContext): Promise<unknown> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: buildSystemPrompt(context) },
          { role: 'user', content: userMessage },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'food_log_parse', strict: true, schema: PARSE_JSON_SCHEMA },
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`OpenAI request failed (${response.status}): ${detail.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI response contained no content');
    }
    return JSON.parse(content);
  }
}
