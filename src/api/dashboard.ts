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
