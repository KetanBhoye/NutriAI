import { ApiError, api, loadStoredCookie } from './client';
import { readNdjson } from './ndjson';
import { API_URL } from '../config';
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

/**
 * The same turn, reporting what the agent is doing as it does it.
 *
 * Logging a meal takes 30-60 seconds — the agent looks the food up on the web
 * before it writes — and a spinner that long reads as a hang. `onStep` fires
 * with the tool names of each round of calls; see features/coach/progress.ts
 * for the wording.
 *
 * Falls back to the plain request on any streaming failure, because progress
 * is a nicety and the answer is not. The fallback re-sends the message: the
 * stream only fails before a `done` line, so nothing was applied twice.
 */
export async function coachChatStreaming(
  input: { message: string; history: CoachHistoryTurn[]; active_date?: string },
  onStep: (tools: string[]) => void
): Promise<CoachTurn> {
  try {
    let done: CoachTurn | null = null;
    let failure: string | null = null;

    await readNdjson<{ type: string; tools?: string[]; error?: string } & Partial<CoachTurn>>({
      url: `${API_URL}/api/coach/chat`,
      body: { ...input, stream: true },
      cookie: await loadStoredCookie(),
      timeoutMs: 120_000,
      onLine: (line) => {
        if (line.type === 'step') onStep(line.tools ?? []);
        else if (line.type === 'done') done = line as CoachTurn;
        else if (line.type === 'error') failure = line.error ?? 'The Coach could not be reached.';
      },
    });

    if (failure) throw new ApiError(502, failure);
    if (done) return done;
    // A stream that ended without a verdict is a bug, not an answer.
    throw new ApiError(502, 'The Coach answered with nothing.');
  } catch (e) {
    // A refused session or a busy model is a real answer — retrying without
    // the stream would only produce the same thing more slowly.
    if (e instanceof ApiError && (e.status === 401 || e.status === 403 || e.status === 429)) throw e;
    return coachChat(input);
  }
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
