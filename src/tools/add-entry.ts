import type { ToolHandler, AddEntryParams } from '../types/index.js';
import { createAuthError, createSuccessResponse, createErrorResponse } from '../utils/responses.js';
import { FoodEntryRepository } from '../repositories/index.js';
import { linkEntryToFood } from '../services/entry-linking.js';

export const addEntryHandler: ToolHandler<AddEntryParams> = async (
  entryData,
  userId,
  env
) => {
  if (!userId) {
    return createAuthError();
  }

  if (!env?.DB) {
    return createErrorResponse('Database not available. Please check your configuration.');
  }

  try {
    // Resolve the canonical food so entries logged conversationally still
    // feed the app's suggestion ranking.
    const linked = await linkEntryToFood(env.DB, userId, entryData);

    const repository = new FoodEntryRepository(env.DB);
    const entryId = await repository.create(linked, userId);

    return createSuccessResponse(
      `Successfully added "${entryData.food_name}" (${entryData.calories} calories) with ID ${entryId} for user ${userId}`
    );
  } catch (error) {
    console.error('Error adding entry:', error);
    return createErrorResponse('Failed to add food entry. Please try again.');
  }
};
