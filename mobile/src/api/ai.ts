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

export interface SuggestMealResponse {
  meal_type: MealType;
  remaining_calories: number | null;
  remaining_protein: number | null;
  /** The kcal range the suggestions were sized to, or null with no goal set. */
  target_band: { min: number; max: number; target: number } | null;
  /** The day's calories are already spent — suggestions are light top-ups. */
  over_budget: boolean;
  suggestions: MealSuggestion[];
}

/**
 * `exclude` carries the dishes already on screen, so "Suggest others" is a
 * different question rather than the same one asked twice. Without it the
 * server sees an identical request and the model returns an identical list.
 */
export function suggestMeal(meal_type: MealType, exclude: string[] = []): Promise<SuggestMealResponse> {
  return api('/api/ai/suggest-meal', {
    method: 'POST',
    body: { meal_type, exclude },
    timeoutMs: 45_000,
  });
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
