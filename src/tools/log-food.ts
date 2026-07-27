import { ToolHandler } from '../types/index.js';
import { createAuthError, createSuccessResponse, createErrorResponse } from '../utils/responses.js';
import { FoodEntryRepository } from '../repositories/index.js';
import { linkEntryToFood } from '../services/entry-linking.js';
import { createProviderFromEnv, parseFoodLog } from '../services/llm/index.js';

export interface LogFoodParams {
  text: string;
}

/**
 * Natural-language food logging over MCP: the same AI pipeline the app's Coach
 * tab uses, exposed as a tool so the connector can log from plain text.
 *
 * Unlike add_entry (which takes explicit macros), this parses "2 rotis and a
 * bowl of dal" into entries — reusing the user's known foods and the strict
 * macro validation — then writes them, linked to the food library so they feed
 * suggestions like any other entry.
 */
export const logFoodHandler: ToolHandler<LogFoodParams> = async (params, userId, env) => {
  if (!userId) return createAuthError();
  if (!env?.DB) return createErrorResponse('Database not available.');

  const provider = createProviderFromEnv();
  if (!provider) {
    return createErrorResponse(
      'AI logging is not configured on the server (no LLM API key set). Use add_entry with explicit macros instead.'
    );
  }

  try {
    const known = await env.DB
      .prepare(
        `SELECT f.canonical_name, f.reference_unit, f.calories_per_unit, f.protein_g_per_unit,
                COUNT(e.id) AS n
         FROM foods f LEFT JOIN food_entries e ON e.food_id = f.id
         WHERE f.user_id = ?
         GROUP BY f.id ORDER BY n DESC LIMIT 25`
      )
      .bind(userId)
      .all();

    const knownRows = (known.results ?? []) as Array<{
      canonical_name: string;
      reference_unit: string;
      calories_per_unit: number;
      protein_g_per_unit: number | null;
    }>;

    const today = new Date().toLocaleDateString('en-CA');
    const result = await parseFoodLog(provider, params.text, {
      today,
      knownFoods: knownRows.map((f) => ({
        name: f.canonical_name,
        unit: f.reference_unit,
        calories_per_unit: f.calories_per_unit,
        protein_per_unit: f.protein_g_per_unit,
      })),
    });

    if (!result.understood || result.items.length === 0) {
      return createSuccessResponse(
        result.clarification ?? "Couldn't read that as food. Name the item and roughly how much."
      );
    }

    const repo = new FoodEntryRepository(env.DB);
    let totalCalories = 0;
    const lines: string[] = [];

    for (const item of result.items) {
      const linked = await linkEntryToFood(env.DB, userId, {
        food_name: item.food_name,
        calories: item.calories,
        protein_g: item.protein_g,
        carbs_g: item.carbs_g,
        fat_g: item.fat_g,
        meal_type: item.meal_type,
        entry_date: result.entry_date,
      });
      await repo.create(linked, userId);
      totalCalories += item.calories;
      lines.push(
        `- ${item.food_name} (${item.meal_type}): ${item.calories} kcal, ${item.protein_g}g P`
      );
    }

    return createSuccessResponse(
      `Logged ${result.items.length} item(s) for ${result.entry_date} — ${totalCalories} kcal total:\n${lines.join('\n')}`
    );
  } catch (error) {
    console.error('log_food error:', error);
    return createErrorResponse('The AI service could not be reached. Try again or use add_entry.');
  }
};
