import { api } from './client';
import { FoodEntry, MealType, Suggestion, Totals } from '../types';

export interface EntriesResponse {
  date: string;
  entries: FoodEntry[];
  totals: Totals;
}

export function getEntries(date: string, limit = 100): Promise<EntriesResponse> {
  return api(`/api/entries?date=${date}&limit=${limit}`);
}

export interface CreateEntryInput {
  food_name: string;
  calories: number;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  meal_type?: MealType;
  entry_date?: string;
  food_id?: string | null;
  quantity?: number;
  unit?: string;
}

export function createEntry(input: CreateEntryInput): Promise<{ entry_id: string; food_id: string | null }> {
  return api('/api/entries', { method: 'POST', body: input });
}

type EntryPatch = Partial<
  Pick<FoodEntry, 'food_name' | 'calories' | 'protein_g' | 'carbs_g' | 'fat_g' | 'meal_type' | 'quantity' | 'unit'>
>;

export function updateEntry(id: string, changes: EntryPatch): Promise<{ success: true }> {
  return api(`/api/entries/${id}`, { method: 'PATCH', body: changes });
}

export function deleteEntry(id: string): Promise<{ success: true }> {
  return api(`/api/entries/${id}`, { method: 'DELETE' });
}

export function getSuggestions(meal: MealType, limit = 8): Promise<{ meal_type: MealType; suggestions: Suggestion[] }> {
  return api(`/api/suggestions?meal=${meal}&limit=${limit}`);
}

export function searchFoods(query: string): Promise<{ query: string; foods: Suggestion[] }> {
  return api(`/api/foods/search?q=${encodeURIComponent(query)}`);
}

export interface BarcodeProduct {
  found: boolean;
  code: string;
  name: string | null;
  brand: string | null;
  /** Manufacturer's serving size, when the product declares one. */
  serving_g: number | null;
  per_100g: {
    calories: number;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
  } | null;
}

export function lookupBarcode(code: string): Promise<BarcodeProduct> {
  return api(`/api/foods/barcode?code=${encodeURIComponent(code)}`);
}
