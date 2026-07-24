import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import z from 'zod';
import type { AppEnv, AuthUser } from '../db/types.js';
import {
  listEntriesHandler,
  type ListEntriesParams,
  addEntryHandler,
  type AddEntryParams,
  logFoodHandler,
  type LogFoodParams,
  updateEntryHandler,
  type UpdateEntryParams,
  deleteEntryHandler,
  type DeleteEntryParams,
  registerUserHandler,
  type RegisterUserParams,
  revokeUserHandler,
  type RevokeUserParams,
  getProfile,
  updateProfile,
  getProfileHistory,
  type GetProfileHistoryParams,
  type UpdateProfileParams,
  addBodyMeasurementHandler,
  listBodyMeasurementsHandler,
  addProgressPhotoHandler,
  listProgressPhotosHandler,
  compareProgressHandler,
  setUserPreferencesHandler,
  getUserPreferencesHandler,
  type AddBodyMeasurementParams,
  type ListBodyMeasurementsParams,
  type AddProgressPhotoParams,
  type ListProgressPhotosParams,
  type CompareProgressParams,
  type SetUserPreferencesParams,
  type GetUserPreferencesParams,
} from '../tools/index.js';

export function createCalorieTrackerMcpServer(env: AppEnv, user: AuthUser): McpServer {
  const server = new McpServer({
    name: 'Calorie Tracker Server',
    version: '2.0.0',
  });

  server.tool(
    'get_user_preferences',
    'Get user-specific goals and behavior instructions saved on the server. By default, long text fields are truncated for connector reliability.',
    {
      include_full_text: z
        .boolean()
        .optional()
        .describe('Set true to return complete behavior_instructions and macros_cache_notes fields.'),
      max_chars_per_field: z
        .number()
        .int()
        .min(500)
        .max(20000)
        .optional()
        .describe('When include_full_text is false, truncate long text fields to this many characters.'),
    },
    async (params) =>
      getUserPreferencesHandler(params as GetUserPreferencesParams, user.userId, env)
  );

  server.tool(
    'set_user_preferences',
    'Set user-specific goals and behavior instructions (stored per user so they work across all MCP clients).',
    {
      display_name: z.string().min(1).max(100).optional(),
      daily_calorie_goal: z.number().int().min(500).max(10000).optional(),
      daily_protein_goal_g: z.number().min(0).max(1000).optional(),
      daily_carbs_goal_g: z.number().min(0).max(2000).optional(),
      daily_fat_goal_g: z.number().min(0).max(1000).optional(),
      behavior_instructions: z.string().max(50000).optional(),
      macros_cache_notes: z.string().max(150000).optional(),
    },
    async (params) =>
      setUserPreferencesHandler(params as SetUserPreferencesParams, user.userId, env)
  );

  server.tool(
    'list_entries',
    'List food entries for a specific date with pagination. Returns daily calorie intake and nutritional data. Use get_user_preferences for personalized goals.',
    {
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
        .optional()
        .describe('Date in YYYY-MM-DD format (optional, defaults to today)'),
      limit: z
        .number()
        .int()
        .min(1, 'Limit must be at least 1')
        .max(100, 'Maximum limit is 100')
        .default(10)
        .optional(),
      offset: z
        .number()
        .int()
        .min(0, 'Offset cannot be negative')
        .default(0)
        .optional(),
    },
    async (params) => listEntriesHandler(params as ListEntriesParams, user.userId, env)
  );

  server.tool(
    'add_entry',
    'Add a new food entry to the calorie tracker. Use get_user_preferences for personalized goals and behavior.',
    {
      food_name: z
        .string()
        .min(1, 'Food name is required')
        .describe('Name of the food item'),
      calories: z
        .number()
        .int()
        .min(0, 'Calories must be a non-negative integer')
        .describe('Number of calories'),
      protein_g: z
        .number()
        .min(0, 'Protein must be a non-negative number')
        .optional()
        .describe('Protein content in grams'),
      carbs_g: z
        .number()
        .min(0, 'Carbs must be a non-negative number')
        .optional()
        .describe('Carbohydrate content in grams'),
      fat_g: z
        .number()
        .min(0, 'Fat must be a non-negative number')
        .optional()
        .describe('Fat content in grams'),
      meal_type: z
        .enum(['breakfast', 'lunch', 'dinner', 'snack'])
        .optional()
        .describe('Type of meal'),
      entry_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
        .optional()
        .describe('Date in YYYY-MM-DD format (defaults to today)'),
    },
    async (params) => addEntryHandler(params as AddEntryParams, user.userId, env)
  );

  server.tool(
    'log_food',
    'Log food from a natural-language description (e.g. "2 rotis, a bowl of dal and 3 boiled eggs for lunch"). The server uses AI (Google Gemini via Vertex) to work out the macros, reusing the user\'s known foods, then records each item. Use this instead of add_entry when the user describes food in plain language rather than giving exact macros.',
    {
      text: z
        .string()
        .min(1, 'Describe what was eaten')
        .describe('Plain-language description of the food and amounts, optionally with a meal and date'),
    },
    async (params) => logFoodHandler(params as LogFoodParams, user.userId, env)
  );

  server.tool(
    'update_entry',
    'Update an existing food entry',
    {
      entry_id: z
        .string()
        .min(1, 'Entry ID is required')
        .describe('ID of the food entry to update'),
      food_name: z
        .string()
        .min(1, 'Food name cannot be empty')
        .optional()
        .describe('Updated name of the food item'),
      calories: z
        .number()
        .int()
        .min(0, 'Calories must be a non-negative integer')
        .optional()
        .describe('Updated number of calories'),
      protein_g: z
        .number()
        .min(0, 'Protein must be a non-negative number')
        .optional()
        .describe('Updated protein content in grams'),
      carbs_g: z
        .number()
        .min(0, 'Carbs must be a non-negative number')
        .optional()
        .describe('Updated carbohydrate content in grams'),
      fat_g: z
        .number()
        .min(0, 'Fat must be a non-negative number')
        .optional()
        .describe('Updated fat content in grams'),
      meal_type: z
        .enum(['breakfast', 'lunch', 'dinner', 'snack'])
        .optional()
        .describe('Updated type of meal'),
    },
    async (params) => updateEntryHandler(params as UpdateEntryParams, user.userId, env)
  );

  server.tool(
    'delete_entry',
    'Delete a food entry',
    {
      entry_id: z
        .string()
        .min(1, 'Entry ID is required')
        .describe('ID of the food entry to delete'),
    },
    async (params) => deleteEntryHandler(params as DeleteEntryParams, user.userId, env)
  );

  server.tool(
    'register_user',
    'Register a new user (admin only)',
    {
      email: z
        .string()
        .email('Invalid email format')
        .describe('Email address of the new user'),
      name: z
        .string()
        .min(1, 'Name is required')
        .describe('Full name of the new user'),
      api_key: z
        .string()
        .optional()
        .describe('Optional custom API key for the new user'),
    },
    async (params) =>
      registerUserHandler(
        params as RegisterUserParams,
        user.userId,
        env,
        user.isAdmin
      )
  );

  server.tool(
    'revoke_user',
    'Revoke a user API key (admin only)',
    {
      user_id: z.string().optional().describe('ID of the user to revoke'),
      email: z
        .string()
        .email('Invalid email format')
        .optional()
        .describe('Email of the user to revoke'),
    },
    async (params) =>
      revokeUserHandler(
        params as RevokeUserParams,
        user.userId,
        env,
        user.isAdmin
      )
  );

  server.tool(
    'get_profile',
    'Get current user profile with calculated BMR/TDEE metrics',
    {},
    async (params) => getProfile(params, user.userId, env)
  );

  server.tool(
    'update_profile',
    'Update user profile information and tracking data',
    {
      height_cm: z
        .number()
        .min(50, 'Height must be at least 50cm')
        .max(300, 'Height must be at most 300cm')
        .optional(),
      age: z
        .number()
        .int()
        .min(1, 'Age must be at least 1')
        .max(150, 'Age must be at most 150')
        .optional(),
      gender: z.enum(['male', 'female']).optional(),
      activity_level: z
        .enum(['sedentary', 'light', 'moderate', 'active', 'very_active'])
        .optional(),
      weight_kg: z
        .number()
        .min(1, 'Weight must be at least 1kg')
        .max(1000, 'Weight must be at most 1000kg')
        .optional(),
      muscle_mass_kg: z
        .number()
        .min(0, 'Muscle mass cannot be negative')
        .max(1000, 'Muscle mass must be at most 1000kg')
        .optional(),
      body_fat_percentage: z
        .number()
        .min(0, 'Body fat percentage cannot be negative')
        .max(100, 'Body fat percentage cannot exceed 100%')
        .optional(),
    },
    async (params) => updateProfile(params as UpdateProfileParams, user.userId, env)
  );

  server.tool(
    'get_profile_history',
    'Get historical profile tracking data with optional date filtering',
    {
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
        .optional(),
      start_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
        .optional(),
      end_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
        .optional(),
      limit: z
        .number()
        .int()
        .min(1, 'Limit must be at least 1')
        .max(100, 'Maximum limit is 100')
        .default(10)
        .optional(),
      offset: z
        .number()
        .int()
        .min(0, 'Offset cannot be negative')
        .default(0)
        .optional(),
    },
    async (params) =>
      getProfileHistory(params as any, user.userId, env)
  );

  server.tool(
    'add_body_measurement',
    'Add a body-composition measurement (e.g., from Dr. Trust scale screenshot). Saves daily vitals and syncs key values to profile tracking.',
    {
      recorded_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
        .optional(),
      source_app: z.string().optional(),
      source_image_url: z.string().url().optional(),
      source_image_ref: z.string().optional(),
      body_weight_kg: z.number().min(1).max(1000).optional(),
      body_mass_index: z.number().min(1).max(100).optional(),
      body_fat_ratio_pct: z.number().min(0).max(100).optional(),
      muscle_rate_pct: z.number().min(0).max(100).optional(),
      body_water_pct: z.number().min(0).max(100).optional(),
      bone_mass_kg: z.number().min(0).max(100).optional(),
      basal_metabolic_rate_kcal: z.number().min(1).max(10000).optional(),
      metabolic_age_years: z.number().int().min(1).max(150).optional(),
      visceral_fat_pct: z.number().min(0).max(100).optional(),
      subcutaneous_fat_pct: z.number().min(0).max(100).optional(),
      protein_mass_kg: z.number().min(0).max(300).optional(),
      muscle_mass_kg: z.number().min(0).max(500).optional(),
      weight_without_fat_kg: z.number().min(0).max(1000).optional(),
      obesity_level: z.string().optional(),
      notes: z.string().optional(),
      raw_payload_json: z.string().optional(),
    },
    async (params) =>
      addBodyMeasurementHandler(params as AddBodyMeasurementParams, user.userId, env)
  );

  server.tool(
    'list_body_measurements',
    'List historical body-composition measurements for progress tracking.',
    {
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
        .optional(),
      start_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
        .optional(),
      end_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
        .optional(),
      limit: z.number().int().min(1).max(200).default(30).optional(),
      offset: z.number().int().min(0).default(0).optional(),
    },
    async (params) =>
      listBodyMeasurementsHandler(params as ListBodyMeasurementsParams, user.userId, env)
  );

  server.tool(
    'add_progress_photo',
    'Save a progress photo reference (front/back/side) with notes so you can compare physique changes later.',
    {
      recorded_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
        .optional(),
      pose_type: z.enum(['front', 'back', 'left_side', 'right_side', 'other']),
      image_url: z.string().url().optional(),
      image_ref: z.string().optional(),
      notes: z.string().optional(),
    },
    async (params) =>
      addProgressPhotoHandler(params as AddProgressPhotoParams, user.userId, env)
  );

  server.tool(
    'list_progress_photos',
    'List stored progress photo references with filters by date and pose type.',
    {
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
        .optional(),
      start_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
        .optional(),
      end_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
        .optional(),
      pose_type: z.enum(['front', 'back', 'left_side', 'right_side', 'other']).optional(),
      limit: z.number().int().min(1).max(200).default(30).optional(),
      offset: z.number().int().min(0).default(0).optional(),
    },
    async (params) =>
      listProgressPhotosHandler(params as ListProgressPhotosParams, user.userId, env)
  );

  server.tool(
    'compare_progress',
    'Compare body measurements between two dates and optionally include progress photo references for side-by-side review.',
    {
      from_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
      to_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
      include_photos: z.boolean().default(true).optional(),
    },
    async (params) =>
      compareProgressHandler(params as CompareProgressParams, user.userId, env)
  );

  return server;
}
