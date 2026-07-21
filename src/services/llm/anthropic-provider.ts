import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt, PARSE_JSON_SCHEMA, type LlmProvider, type ParseContext } from './types.js';

/**
 * Anthropic-backed parser using the Messages API with structured outputs, so
 * the response is guaranteed to match the parse schema rather than being
 * free-text we then have to salvage.
 *
 * Model is configurable via LLM_MODEL. The default is Opus 4.8; for this
 * high-volume extraction task Haiku 4.5 (`claude-haiku-4-5`) costs a fraction
 * as much and is well suited to it — set LLM_MODEL to switch.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model || 'claude-opus-4-8';
  }

  async parseFoodLog(userMessage: string, context: ParseContext): Promise<unknown> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      system: buildSystemPrompt(context),
      output_config: {
        format: {
          type: 'json_schema',
          schema: PARSE_JSON_SCHEMA,
        },
      },
      messages: [{ role: 'user', content: userMessage }],
    });

    const block = response.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') {
      throw new Error('Anthropic response contained no text block');
    }
    return JSON.parse(block.text);
  }
}
