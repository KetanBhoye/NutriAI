import { api } from './client';
import { CoachHistoryTurn, CoachTurn, MealType } from '../types';

export function getAiStatus(): Promise<{ configured: boolean }> {
  return api<{ configured: boolean }>('/api/ai/status').catch(() => ({ configured: false }));
}

export function coachChat(input: {
  message: string;
  history: CoachHistoryTurn[];
  active_date?: string;
}): Promise<CoachTurn> {
  return api('/api/coach/chat', { method: 'POST', body: input, timeoutMs: 45_000 });
}

export interface MealSuggestion {
  name: string;
  description: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export function suggestMeal(meal_type: MealType): Promise<{
  meal_type: MealType;
  remaining_calories: number;
  remaining_protein: number;
  suggestions: MealSuggestion[];
}> {
  return api('/api/ai/suggest-meal', { method: 'POST', body: { meal_type }, timeoutMs: 45_000 });
}

export interface PhotoItem {
  food_name: string;
  quantity: number | null;
  unit: string | null;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

export interface PhotoResult {
  understood: boolean;
  note: string | null;
  items: PhotoItem[];
}

/**
 * Sends a JPEG data URL (or bare base64) to Vertex vision for parsing. Slow —
 * the model reads the image and cross-references the user's food library.
 */
export function parseMealPhoto(image: string): Promise<PhotoResult> {
  return api('/api/ai/photo', { method: 'POST', body: { image }, timeoutMs: 60_000 });
}
