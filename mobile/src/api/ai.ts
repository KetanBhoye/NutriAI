import { ApiError, api, loadStoredCookie } from './client';
import { readNdjson } from './ndjson';
import { API_URL } from '../config';
import { CoachHistoryTurn, CoachTurn, MealType } from '../types';

export function getAiStatus(): Promise<{ configured: boolean }> {
  return api<{ configured: boolean }>('/api/ai/status').catch(() => ({ configured: false }));
}

export interface CoachTurnInput {
  message: string;
  history: CoachHistoryTurn[];
  active_date?: string;
  /**
   * Identifies this user message, so sending it twice runs it once.
   *
   * The streaming path below retries on a broken connection, and a
   * backgrounded app breaks the connection *after* the agent has already
   * written entries — which logged meals twice. The retry carries the same id,
   * and the server replays the original answer instead of running again.
   */
  turn_id?: string;
}

export function coachChat(input: CoachTurnInput): Promise<CoachTurn> {
  return api('/api/coach/chat', { method: 'POST', body: input, timeoutMs: 45_000 });
}

/**
 * An id for one user message. Not a UUID: this only has to be unique among a
 * single user's recent turns, and `crypto.randomUUID` is not on every RN
 * runtime this app supports.
 */
export function newTurnId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
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
 * is a nicety and the answer is not.
 *
 * The fallback re-sends the message, which used to assume a broken stream
 * meant nothing had been applied. It does not: backgrounding the app kills the
 * connection while the server keeps running the turn, so the retry logged
 * every meal a second time. Both attempts now carry the same `turn_id`, and
 * the server runs it once.
 */
export async function coachChatStreaming(
  input: CoachTurnInput,
  onStep: (tools: string[]) => void
): Promise<CoachTurn> {
  // One id for both attempts. Generated here rather than by the caller so the
  // fallback below cannot accidentally send a different one — which would make
  // the retry a second turn again, and the duplicate entries would be back.
  const turn: CoachTurnInput = { ...input, turn_id: input.turn_id ?? newTurnId() };
  try {
    let done: CoachTurn | null = null;
    let failure: string | null = null;

    await readNdjson<{ type: string; tools?: string[]; error?: string } & Partial<CoachTurn>>({
      url: `${API_URL}/api/coach/chat`,
      body: { ...turn, stream: true },
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
    return coachChat(turn);
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
export function suggestMeal(
  meal_type: MealType,
  exclude: string[] = [],
  /**
   * The day being logged to. Without it the server answered for *its* idea of
   * today — UTC — so the "remaining calories" quoted in the sheet came from
   * the wrong day's entries for anyone east of UTC, and from today's when the
   * user was browsing an earlier date.
   */
  date?: string
): Promise<SuggestMealResponse> {
  return api('/api/ai/suggest-meal', {
    method: 'POST',
    body: { meal_type, exclude, ...(date ? { date } : {}) },
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
