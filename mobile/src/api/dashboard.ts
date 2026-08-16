import { api } from './client';
import { DashboardPayload, WeeklyInsights, WeeklyStats } from '../types';

export function getDashboard(date: string): Promise<DashboardPayload> {
  return api(`/api/dashboard?date=${date}`);
}

export function getWeeklyStats(days = 30): Promise<WeeklyStats> {
  return api(`/api/stats/weekly?days=${days}`);
}

export function getWeeklyInsights(refresh = false): Promise<WeeklyInsights> {
  return api(`/api/insights/weekly${refresh ? '?refresh=1' : ''}`, { timeoutMs: 45_000 });
}

export interface ShareStats {
  date: string;
  name: string;
  calories: { consumed: number; goal: number | null };
  protein: { consumed: number; goal: number | null };
  carbs_g: number;
  fat_g: number;
  steps: number | null;
  streak: number;
  weight_kg: number | null;
  /** Change since the start of the plan; negative means weight lost. */
  weight_change_kg: number | null;
}

export function getShareStats(date: string): Promise<ShareStats> {
  return api(`/api/share/today?date=${date}`);
}

/**
 * The consistency score shown at the top of Trends.
 *
 * `comparison` is null whenever the server decided not to show one — too few
 * members, too little logged, or a percentile low enough that saying it would
 * do more harm than good. The client never sees the suppressed number, so
 * there is nothing here to accidentally render.
 */
export interface ConsistencyComponents {
  logging: number;
  calories: number;
  /** Null when the user has no goal for it — render "not tracked", not 0%. */
  protein: number | null;
  movement: number | null;
}

export interface Consistency {
  available: true;
  week_start: string;
  score: number;
  days_logged: number;
  previous_score: number | null;
  personal_best: number | null;
  is_personal_best: boolean;
  components: ConsistencyComponents;
  headline: { band: 'building' | 'steady' | 'strong' | 'excellent'; title: string; detail: string };
  history: Array<{ weekStart: string; score: number }>;
  comparison: { better_than_percent: number; population: number } | null;
}

export interface ConsistencyUnavailable {
  available: false;
  reason: string;
}

export function getConsistency(date: string): Promise<Consistency | ConsistencyUnavailable> {
  return api(`/api/consistency?date=${date}`);
}
