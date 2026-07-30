import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// Tool handler type
export interface ToolHandler<T = Record<string, unknown>> {
  (
    params: T,
    userId?: string,
    env?: any,
    isAdmin?: boolean
  ): Promise<CallToolResult>;
}

// Food entry types
export interface FoodEntry {
  id: string;
  user_id: string;
  food_name: string;
  calories: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  meal_type?: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  entry_date: string;
  created_at: string;
  updated_at?: string;
}

// User types
export interface User {
  id: string;
  name: string;
  email: string;
  api_key_hash?: string;
  role: 'user' | 'admin';
  created_at: string;
  updated_at?: string;
}

// User profile types
export interface UserProfile {
  user_id: string;
  height_cm: number;
  age: number;
  gender: 'male' | 'female';
  activity_level: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
  created_at: string;
  updated_at: string;
}

export interface ProfileTracking {
  id: string;
  user_id: string;
  weight_kg?: number;
  muscle_mass_kg?: number;
  body_fat_percentage?: number;
  bmr_calories?: number;
  tdee_calories?: number;
  recorded_date: string;
  created_at: string;
}

export interface ProfileWithCalculations extends UserProfile {
  latest_tracking?: ProfileTracking;
  bmr_calories?: number;
  tdee_calories?: number;
}

export interface BodyMeasurement {
  id: string;
  user_id: string;
  recorded_date: string;
  source_app?: string;
  source_image_url?: string;
  source_image_ref?: string;
  body_weight_kg?: number;
  body_mass_index?: number;
  body_fat_ratio_pct?: number;
  muscle_rate_pct?: number;
  body_water_pct?: number;
  bone_mass_kg?: number;
  basal_metabolic_rate_kcal?: number;
  metabolic_age_years?: number;
  visceral_fat_pct?: number;
  subcutaneous_fat_pct?: number;
  protein_mass_kg?: number;
  muscle_mass_kg?: number;
  weight_without_fat_kg?: number;
  obesity_level?: string;
  notes?: string;
  raw_payload_json?: string;
  created_at: string;
  updated_at: string;
}

export type ProgressPoseType = 'front' | 'back' | 'left_side' | 'right_side' | 'other';

export interface ProgressPhoto {
  id: string;
  user_id: string;
  recorded_date: string;
  pose_type: ProgressPoseType;
  image_url?: string;
  image_ref?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface UserTrackingPreferences {
  user_id: string;
  display_name?: string;
  daily_calorie_goal?: number;
  daily_protein_goal_g?: number;
  daily_carbs_goal_g?: number;
  daily_fat_goal_g?: number;
  behavior_instructions?: string;
  macros_cache_notes?: string;
  created_at: string;
  updated_at: string;
}

// Tool parameter types
export interface AddEntryParams {
  food_name: string;
  calories: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  meal_type?: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  entry_date?: string;
  /**
   * Link to the canonical food. Suggestions are ranked by joining entries to
   * foods, so an entry without this is invisible to the ranking — the API
   * resolves it by name when the caller doesn't supply it.
   */
  food_id?: string;
  quantity?: number;
  unit?: string;
}

export interface UpdateEntryParams {
  entry_id: string;
  food_name?: string;
  calories?: number;
  /** `null` clears the macro; omitting it leaves the stored value alone. */
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  meal_type?: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  /** Portion size. The mobile app records this in grams (`unit: 'g'`). */
  quantity?: number;
  unit?: string;
}

export interface DeleteEntryParams {
  entry_id: string;
}

export interface ListEntriesParams {
  date?: string;
  limit?: number;
  offset?: number;
}

export interface RegisterUserParams {
  name: string;
  email: string;
  api_key?: string;
}

export interface RevokeUserParams {
  user_id?: string;
  email?: string;
}

// Profile tool parameter types
export interface UpdateProfileParams {
  height_cm?: number;
  age?: number;
  gender?: 'male' | 'female';
  activity_level?:
    | 'sedentary'
    | 'light'
    | 'moderate'
    | 'active'
    | 'very_active';
  weight_kg?: number;
  muscle_mass_kg?: number;
  body_fat_percentage?: number;
}

export interface GetProfileHistoryParams {
  date?: string;
  start_date?: string;
  end_date?: string;
  limit?: number;
  offset?: number;
}

export interface AddBodyMeasurementParams {
  recorded_date?: string;
  source_app?: string;
  source_image_url?: string;
  source_image_ref?: string;
  body_weight_kg?: number;
  body_mass_index?: number;
  body_fat_ratio_pct?: number;
  muscle_rate_pct?: number;
  body_water_pct?: number;
  bone_mass_kg?: number;
  basal_metabolic_rate_kcal?: number;
  metabolic_age_years?: number;
  visceral_fat_pct?: number;
  subcutaneous_fat_pct?: number;
  protein_mass_kg?: number;
  muscle_mass_kg?: number;
  weight_without_fat_kg?: number;
  obesity_level?: string;
  notes?: string;
  raw_payload_json?: string;
}

export interface ListBodyMeasurementsParams {
  date?: string;
  start_date?: string;
  end_date?: string;
  limit?: number;
  offset?: number;
}

export interface AddProgressPhotoParams {
  recorded_date?: string;
  pose_type: ProgressPoseType;
  image_url?: string;
  image_ref?: string;
  notes?: string;
}

export interface ListProgressPhotosParams {
  date?: string;
  start_date?: string;
  end_date?: string;
  pose_type?: ProgressPoseType;
  limit?: number;
  offset?: number;
}

export interface CompareProgressParams {
  from_date: string;
  to_date: string;
  include_photos?: boolean;
}

export interface SetUserPreferencesParams {
  display_name?: string;
  daily_calorie_goal?: number;
  daily_protein_goal_g?: number;
  daily_carbs_goal_g?: number;
  daily_fat_goal_g?: number;
  behavior_instructions?: string;
  macros_cache_notes?: string;
}

export interface GetUserPreferencesParams {
  include_full_text?: boolean;
  max_chars_per_field?: number;
}
