export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface Totals {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface FoodEntry {
  id: string;
  user_id: string;
  food_name: string;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  meal_type: MealType | null;
  entry_date: string;
  food_id: string | null;
  quantity: number | null;
  unit: string | null;
  created_at: string;
  updated_at: string;
}

export interface Suggestion {
  id: string;
  canonical_name: string;
  normalized_key: string;
  reference_unit: string;
  calories_per_unit: number;
  protein_g_per_unit: number | null;
  carbs_g_per_unit: number | null;
  fat_g_per_unit: number | null;
  default_quantity: number;
  source: string;
  times_logged: number;
  last_logged: string | null;
  score: number;
}

export interface Goals {
  daily_calorie_goal?: number | null;
  daily_protein_goal_g?: number | null;
  daily_carbs_goal_g?: number | null;
  daily_fat_goal_g?: number | null;
}

export interface GlideWeek {
  week: number;
  date: string;
  target_kg: number;
  actual_kg: number | null;
  status: 'ahead' | 'on' | 'watch' | 'behind' | 'empty';
}

export interface GoalPlan {
  start_weight_kg: number;
  start_date: string;
  goal_weight_kg: number;
  target_date: string;
  tolerance_kg: number;
  daily_step_goal: number | null;
  weekly_training_days: number | null;
}

export interface WeeklyDeficit {
  week_start: string;
  days_logged: number;
  total_deficit: number;
  projected_kg: number;
}

export interface DailyActivity {
  activity_date: string;
  steps: number | null;
  active_energy_kcal: number | null;
  weight_kg?: number | null;
  exercise_minutes?: number | null;
  exercise_type?: string | null;
  /** Net energy of a hand-logged session; counts towards the day's deficit. */
  exercise_kcal?: number | null;
}

export interface WeighIn {
  recorded_date: string;
  weight_kg: number;
}

/**
 * The plan measured against what actually happened. Computed server-side (see
 * `src/services/goal-progress.ts`) so the app and the coach can't disagree
 * about whether you're on track.
 */
export interface PlanProgress {
  baseline_kg: number | null;
  actual_kg: number | null;
  readings_used: number;
  /** Positive is always *behind*, whichever way the goal points. */
  delta_kg: number | null;
  status: GlideWeek['status'];
  planned_rate_kg_per_week: number;
  actual_rate_kg_per_week: number | null;
  required_rate_kg_per_week: number | null;
  projected_kg_at_target: number | null;
  projected_goal_date: string | null;
  days_off_plan: number | null;
  /** Daily calorie change that would close the gap. Negative means eat less. */
  suggested_calorie_delta: number | null;
  days_elapsed: number;
  days_remaining: number;
  headline: string;
}

export interface GoalsPayload {
  plan: GoalPlan | null;
  /** Every weigh-in inside the plan window, for the daily trend chart. */
  weigh_ins?: WeighIn[];
  progress?: PlanProgress | null;
  macros: {
    calories: number | null;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
  };
  glide_path: GlideWeek[];
  weekly_deficit: WeeklyDeficit[];
  latest_weight: number | null;
  activity: DailyActivity[];
}

export interface ProfileBasics {
  height_cm: number | null;
  age: number | null;
  gender: 'male' | 'female' | null;
  activity_level: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active' | null;
}

export interface WeeklyStats {
  days: number;
  daily: Array<{
    entry_date: string;
    calories: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    entry_count: number;
  }>;
  streak: number;
  days_logged: number;
  complete_days: number;
  average_calories: number;
  complete_day_threshold: number;
}

export interface WeeklyInsights {
  report: {
    headline: string;
    summary: string;
    wins: string[];
    focus: string[];
  } | null;
  stats: WeeklyStats;
  generated_at: string;
  source: 'ai' | 'rule' | 'insufficient';
}

export interface CoachHistoryTurn {
  role: 'user' | 'model';
  parts: unknown[];
}

export interface CoachTurn {
  reply: string;
  actions: string[];
  history: CoachHistoryTurn[];
}

export interface DashboardPayload {
  date: string;
  totals: Totals;
  profile?: Record<string, number | null> | null;
}
