import { api } from './client';
import { GoalPlan, GoalsPayload } from '../types';

export function getGoals(): Promise<GoalsPayload> {
  return api('/api/goals');
}

export type GoalPlanInput = GoalPlan & {
  daily_calorie_goal?: number | null;
  daily_protein_goal_g?: number | null;
  daily_carbs_goal_g?: number | null;
  daily_fat_goal_g?: number | null;
};

export function saveGoals(plan: GoalPlanInput): Promise<{ ok: true }> {
  return api('/api/goals', { method: 'PUT', body: plan });
}

export interface PreferencesInput {
  display_name?: string;
  daily_calorie_goal: number;
  daily_protein_goal_g: number;
  daily_carbs_goal_g: number;
  daily_fat_goal_g: number;
}

export function savePreferences(input: PreferencesInput): Promise<{ ok: true }> {
  return api('/api/preferences', { method: 'PUT', body: input });
}

export function logActivity(input: {
  activity_date: string;
  weight_kg?: number | null;
  steps?: number | null;
}): Promise<{ ok: true; activity_date: string }> {
  return api('/api/activity', { method: 'POST', body: input });
}
