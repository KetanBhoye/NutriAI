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
