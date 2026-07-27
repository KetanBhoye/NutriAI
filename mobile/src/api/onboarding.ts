import { api } from './client';
import { ActivityLevel, Gender, Goal, Macros } from '../nutrition';

export interface AiPlanInput {
  display_name: string;
  gender: Gender | null;
  age: number | null;
  height_cm: number | null;
  weight_kg: number;
  activity_level: ActivityLevel;
  goal: Goal;
  target_weight_kg: number | null;
  target_rate_kg_per_week: number | null;
  bmr: number;
  tdee: number;
  baseline: Macros;
}

/**
 * NB: the server returns `daily_*` field names here, not the `calories` /
 * `protein_g` shape used by `Macros` elsewhere — see the backend's
 * src/services/coach/onboarding-plan.ts.
 */
export interface OnboardingPlan {
  daily_calorie_goal: number;
  daily_protein_goal_g: number;
  daily_carbs_goal_g: number;
  daily_fat_goal_g: number;
  summary: string;
}

export function postAiPlan(input: AiPlanInput): Promise<{ plan: OnboardingPlan } | null> {
  return api<{ plan: OnboardingPlan }>('/api/onboarding/ai-plan', {
    method: 'POST',
    body: input,
    timeoutMs: 45_000,
  }).catch(() => null);
}

export interface OnboardingCompleteInput {
  display_name: string;
  gender: Gender;
  age: number;
  height_cm: number;
  weight_kg: number;
  activity_level: ActivityLevel;
  goal: Goal;
  daily_calorie_goal: number;
  daily_protein_goal_g: number;
  daily_carbs_goal_g: number;
  daily_fat_goal_g: number;
  target_weight_kg?: number | null;
  target_date?: string | null;
}

export function postOnboardingComplete(input: OnboardingCompleteInput): Promise<{ ok: true }> {
  return api('/api/onboarding/complete', { method: 'POST', body: input });
}
