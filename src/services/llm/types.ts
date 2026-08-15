import { z } from 'zod';
import { CONSERVATIVE_ESTIMATION_RULES } from '../coach/macro-sanity.js';

/**
 * Structured result the LLM must return when parsing a natural-language food
 * message. Kept deliberately flat and bounded so a bad model response can be
 * rejected before it reaches the food log.
 */
export const parsedItemSchema = z.object({
  food_name: z.string().min(1).max(200),
  quantity: z.number().positive().max(10000),
  unit: z.string().min(1).max(20),
  meal_type: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
  // Bounds mirror the manual-entry endpoint: a single logged item cannot
  // plausibly exceed these, so a hallucinated 90,000 kcal item is rejected.
  calories: z.number().min(0).max(5000),
  protein_g: z.number().min(0).max(500),
  carbs_g: z.number().min(0).max(1000),
  fat_g: z.number().min(0).max(500),
});

export const parseResultSchema = z.object({
  /** False when the message isn't about food at all, or is too vague to log. */
  understood: z.boolean(),
  /** A question to ask the user when the message can't be logged confidently. */
  clarification: z.string().max(500).nullable(),
  /** YYYY-MM-DD the entries belong to, resolved from "today"/"yesterday"/etc. */
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z.array(parsedItemSchema).max(20),
});

export type ParsedItem = z.infer<typeof parsedItemSchema>;
export type ParseResult = z.infer<typeof parseResultSchema>;

/** JSON Schema handed to the provider's structured-output mode. */
export const PARSE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    understood: { type: 'boolean' },
    clarification: { type: ['string', 'null'] },
    entry_date: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          food_name: { type: 'string' },
          quantity: { type: 'number' },
          unit: { type: 'string' },
          meal_type: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] },
          calories: { type: 'number' },
          protein_g: { type: 'number' },
          carbs_g: { type: 'number' },
          fat_g: { type: 'number' },
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

export interface ParseContext {
  /** Local date the user is logging on, as YYYY-MM-DD. */
  today: string;
  /**
   * A few of the user's most-logged foods with their per-unit macros, so the
   * model reuses their verified values instead of estimating from scratch.
   */
  knownFoods: Array<{
    name: string;
    unit: string;
    calories_per_unit: number;
    protein_per_unit: number | null;
  }>;
}

/**
 * A provider turns a user message + context into a ParseResult. Implementations
 * wrap a specific vendor's API; the rest of the app depends only on this.
 */
export interface LlmProvider {
  readonly name: string;
  parseFoodLog(userMessage: string, context: ParseContext): Promise<unknown>;
}

/**
 * Builds the system prompt. The output contract is spelled out here rather than
 * relying on the schema alone, because the hard part isn't JSON shape — it's
 * getting sane macro estimates for Indian home cooking and knowing when to ask
 * instead of guess.
 */
export function buildSystemPrompt(context: ParseContext): string {
  const known =
    context.knownFoods.length > 0
      ? context.knownFoods
          .map(
            (f) =>
              `- ${f.name}: ${f.calories_per_unit} kcal per ${f.unit}` +
              (f.protein_per_unit !== null ? `, ${f.protein_per_unit}g protein per ${f.unit}` : '')
          )
          .join('\n')
      : '(none yet)';

  return `You convert a person's plain-language description of what they ate into structured food-log entries. You return ONLY the structured object defined by the schema — no prose.

Today is ${context.today}. Resolve "today" to that date, "yesterday" to the day before, and any explicit date the user gives. Default to today when no date is mentioned.

MACROS:
- Give calories, protein, carbs and fat for the TOTAL quantity eaten, not per 100g.
- This user eats mostly Indian home-cooked food (dal, sabji, chapati, rice, paneer, eggs, whey). Use realistic values for those — a chapati is ~70-80 kcal, 100g cooked dal ~110 kcal, 100g cooked rice ~130 kcal, one boiled egg ~70 kcal.
- Prefer the user's own known foods and their values when the message matches one:
${known}
- When you genuinely don't know a packaged product's macros, estimate conservatively and still return numbers — do not leave them at zero unless the food truly has none (black coffee, diet soda).

${CONSERVATIVE_ESTIMATION_RULES}

MEAL TYPE:
- Use the meal the user names. If they don't, infer from the food and, failing that, from a sensible default (cereal/eggs → breakfast, a protein shake → snack).

NAMING:
- Name each item the way it would appear in a food diary, including the quantity: "Chapati (2)", "Cooked rice (150g)", "Boiled eggs (3)". Do not put a macro figure in the name.

WHEN TO ASK INSTEAD OF GUESS:
- If the message is not about food, set understood=false, items=[], and put a short reply in clarification.
- If a quantity is truly missing and changes the result a lot ("I had biryani" with no amount), set understood=false and ask for the portion in clarification.
- Otherwise set understood=true and fill items.`;
}
