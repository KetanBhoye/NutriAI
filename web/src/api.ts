/**
 * API client.
 *
 * Every write goes through a durable queue: on a phone, a log attempt can hit
 * a dead lift or a tunnel, and losing the entry (or making the user wait for a
 * spinner that never resolves) is the difference between an app that gets used
 * daily and one that doesn't. Writes are persisted to localStorage first, then
 * flushed — so a queued entry survives a reload or the app being killed.
 */
import { ref } from 'vue';

const QUEUE_KEY = 'nutriai.pending.v1';
const REQUEST_TIMEOUT_MS = 10_000;

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface FoodEntry {
  id: string;
  food_name: string;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  meal_type: MealType | null;
  entry_date: string;
  /** Portion this entry was logged at; null on rows predating the food library. */
  quantity?: number | null;
  unit?: string | null;
  /** Present only on optimistic local rows that haven't reached the server. */
  pending?: boolean;
}

export interface Totals {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface Suggestion {
  id: string;
  canonical_name: string;
  reference_unit: string;
  calories_per_unit: number;
  protein_g_per_unit: number | null;
  carbs_g_per_unit: number | null;
  fat_g_per_unit: number | null;
  default_quantity: number;
  times_logged: number;
  last_logged: string;
}

export interface LookupResult {
  name: string;
  brand: string | null;
  /** The provider's own numbers don't reconcile — show a warning. */
  suspect: boolean;
  calories_per_unit: number;
  protein_g_per_unit: number | null;
  carbs_g_per_unit: number | null;
  fat_g_per_unit: number | null;
  reference_unit: 'g';
  default_quantity: number;
  source: 'openfoodfacts' | 'usda';
  source_ref: string | null;
}

interface QueuedWrite {
  id: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  createdAt: number;
}

export const isOnline = ref(navigator.onLine);
export const pendingCount = ref(0);

window.addEventListener('online', () => {
  isOnline.value = true;
  void flushQueue();
});
window.addEventListener('offline', () => {
  isOnline.value = false;
});

function readQueue(): QueuedWrite[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedWrite[]) : [];
  } catch {
    // A corrupt queue must not brick logging — drop it and carry on.
    localStorage.removeItem(QUEUE_KEY);
    return [];
  }
}

function writeQueue(queue: QueuedWrite[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  pendingCount.value = queue.length;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(path, {
      ...init,
      signal: controller.signal,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });

    if (response.status === 401) {
      // Send the user to the in-app auth screen, not the old server page.
      if (!window.location.pathname.startsWith('/app/login')) {
        window.location.assign('/app/login');
      }
      throw new ApiError('Session expired', 401);
    }

    if (!response.ok) {
      const detail = await response.text();
      throw new ApiError(detail || `Request failed (${response.status})`, response.status);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

// Only one flush may run at a time. Without this guard, enqueuing several
// writes in the same tick (e.g. confirming a multi-item AI parse) starts
// several concurrent flushes that each read the same queue head and send it
// before any of them removes it — silently double-logging the first item.
let flushing = false;

/** Sends queued writes oldest-first, stopping at the first failure so ordering holds. */
export async function flushQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    let queue = readQueue();

    while (queue.length > 0) {
      const [next] = queue;
      if (!next) break;

      try {
        await request(next.path, {
          method: next.method,
          body: next.body ? JSON.stringify(next.body) : undefined,
        });
      } catch (error) {
        // A 4xx will never succeed on retry — drop it rather than blocking the
        // queue forever behind a permanently invalid write.
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          queue = queue.slice(1);
          writeQueue(queue);
          continue;
        }
        return;
      }

      // Re-read: another enqueue may have appended while this request was in
      // flight. Drop the head we just sent and keep anything new.
      queue = readQueue().slice(1);
      writeQueue(queue);
    }
  } finally {
    flushing = false;
  }
}

function enqueue(method: QueuedWrite['method'], path: string, body?: unknown): void {
  const queue = readQueue();
  queue.push({ id: crypto.randomUUID(), method, path, body, createdAt: Date.now() });
  writeQueue(queue);
  void flushQueue();
}

export interface Goals {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

/** Used only until the real goals arrive, and if preferences hold none. */
export const FALLBACK_GOALS: Goals = {
  calories: 1900,
  protein_g: 150,
  carbs_g: 190,
  fat_g: 63,
};

export interface Me {
  id: string;
  name: string;
  email: string;
  role: string;
  onboarded: boolean;
  goals: Partial<Goals> | null;
}

export const api = {
  async me(): Promise<Me> {
    return request('/api/me');
  },

  async login(email: string, password: string): Promise<void> {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ApiError(d.error ?? 'Login failed', res.status);
    }
  },

  async signup(name: string, email: string, password: string): Promise<void> {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ApiError(d.error ?? 'Signup failed', res.status);
    }
  },

  async logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  },

  /** Permanently deletes the account and all its data. */
  async deleteAccount(): Promise<void> {
    const res = await fetch('/api/account', { method: 'DELETE', credentials: 'same-origin' });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ApiError(d.error ?? 'Failed to delete account', res.status);
    }
  },

  async saveOnboarding(prefs: {
    display_name: string;
    daily_calorie_goal: number;
    daily_protein_goal_g: number;
    daily_carbs_goal_g: number;
    daily_fat_goal_g: number;
  }): Promise<void> {
    await request('/api/preferences', { method: 'PUT', body: JSON.stringify(prefs) });
  },

  /**
   * Asks the server (Vertex AI) to refine the wizard's baseline into a
   * personalised plan. Resolves null when the server has no AI configured or
   * the call fails — the caller then keeps its own computed baseline.
   */
  async aiPlan(body: Record<string, unknown>): Promise<{
    daily_calorie_goal: number;
    daily_protein_goal_g: number;
    daily_carbs_goal_g: number;
    daily_fat_goal_g: number;
    summary: string;
  } | null> {
    try {
      const res = await fetch('/api/onboarding/ai-plan', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return null;
      return (await res.json()).plan ?? null;
    } catch {
      return null;
    }
  },

  async completeOnboarding(body: Record<string, unknown>): Promise<void> {
    await request('/api/onboarding/complete', { method: 'POST', body: JSON.stringify(body) });
  },

  /** Manually log steps and/or weight for a day (upserts into daily activity). */
  async logActivity(body: {
    activity_date: string;
    steps?: number | null;
    weight_kg?: number | null;
  }): Promise<void> {
    await request('/api/activity', { method: 'POST', body: JSON.stringify(body) });
  },

  async getGoals(): Promise<Goals> {
    const me = await request<{ goals: Partial<Goals> | null }>('/api/me');
    return {
      calories: me.goals?.calories ?? FALLBACK_GOALS.calories,
      protein_g: me.goals?.protein_g ?? FALLBACK_GOALS.protein_g,
      carbs_g: me.goals?.carbs_g ?? FALLBACK_GOALS.carbs_g,
      fat_g: me.goals?.fat_g ?? FALLBACK_GOALS.fat_g,
    };
  },

  async getEntries(date: string): Promise<{ entries: FoodEntry[]; totals: Totals }> {
    return request(`/api/entries?date=${encodeURIComponent(date)}&limit=100`);
  },

  async getSuggestions(meal: MealType, limit = 8): Promise<{ suggestions: Suggestion[] }> {
    return request(`/api/suggestions?meal=${meal}&limit=${limit}`);
  },

  async searchFoods(query: string): Promise<{ foods: Suggestion[] }> {
    return request(`/api/foods/search?q=${encodeURIComponent(query)}`);
  },

  async getDashboard(): Promise<unknown> {
    return request('/api/dashboard');
  },

  async shareStats(date: string): Promise<import('./share').ShareStats> {
    return request<import('./share').ShareStats>(`/api/share/today?date=${encodeURIComponent(date)}`);
  },

  /** Sends a meal photo to Gemini vision; returns detected items to confirm. */
  async photoParse(imageDataUrl: string): Promise<{
    understood: boolean;
    note: string;
    items: Array<{
      food_name: string;
      quantity: number;
      unit: string;
      calories: number;
      protein_g: number;
      carbs_g: number;
      fat_g: number;
    }>;
  }> {
    return request('/api/ai/photo', { method: 'POST', body: JSON.stringify({ image: imageDataUrl }) });
  },

  /** External food databases, for foods with no logging history. */
  async lookupFood(query: string): Promise<{ results: LookupResult[] }> {
    return request(`/api/foods/lookup?q=${encodeURIComponent(query)}`);
  },

  /** Adds a food to the personal library and returns its id. */
  async createFood(food: {
    canonical_name: string;
    reference_unit: string;
    calories_per_unit: number;
    protein_g_per_unit?: number;
    carbs_g_per_unit?: number;
    fat_g_per_unit?: number;
    default_quantity: number;
    source: 'openfoodfacts' | 'usda' | 'manual';
  }): Promise<{ food_id: string }> {
    return request('/api/foods', { method: 'POST', body: JSON.stringify(food) });
  },

  /**
   * Queues the entry and resolves immediately. The caller renders it
   * optimistically; the queue guarantees it reaches the server eventually.
   */
  createEntry(entry: {
    food_name: string;
    calories: number;
    protein_g?: number;
    carbs_g?: number;
    fat_g?: number;
    meal_type: MealType;
    entry_date: string;
    /** Links the entry to the library so it feeds future suggestions. */
    food_id?: string;
    quantity?: number;
    unit?: string;
  }): void {
    enqueue('POST', '/api/entries', entry);
  },

  updateEntry(entryId: string, changes: Partial<FoodEntry>): void {
    enqueue('PATCH', `/api/entries/${entryId}`, changes);
  },

  deleteEntry(entryId: string): void {
    enqueue('DELETE', `/api/entries/${entryId}`);
  },
};

pendingCount.value = readQueue().length;
void flushQueue();
