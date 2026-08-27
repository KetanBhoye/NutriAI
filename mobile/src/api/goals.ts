import { api } from './client';
import { todayISO } from '../dates';
import { GoalPlan, GoalsPayload } from '../types';

/**
 * Sends the phone's calendar day, because the server cannot know it.
 *
 * Plan progress filters weigh-ins to "on or before today" and dates the glide
 * path from it, so a UTC day dropped this morning's weigh-in and judged the
 * plan against yesterday's line for anyone east of UTC.
 */
export function getGoals(): Promise<GoalsPayload> {
  return api(`/api/goals?date=${todayISO()}`);
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
  exercise_minutes?: number | null;
  exercise_type?: string | null;
  exercise_kcal?: number | null;
}): Promise<{ ok: true; activity_date: string }> {
  return api('/api/activity', { method: 'POST', body: input });
}
