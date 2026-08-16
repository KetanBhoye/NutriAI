import { randomUUID } from 'node:crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import z from 'zod';
import { humanValidationError } from './validation.js';
import type { AppEnv } from '../db/types.js';
import {
  createSession,
  clearSessionCookie,
  destroySession,
  getSessionIdFromCookie,
  getSessionUser,
  setSessionCookie,
  type SessionUser,
} from '../auth/session.js';
import {
  createPasswordHash,
  hashSha256,
  randomToken,
  verifyPassword,
} from '../auth/security.js';
import { FoodEntryRepository } from '../repositories/food-entry.repository.js';
import { FoodLibraryRepository, type MealType } from '../repositories/food-library.repository.js';
import { UserProfileRepository } from '../repositories/user-profile.repository.js';
import { ProfileTrackingRepository } from '../repositories/profile-tracking.repository.js';
import { updateProfile, getProfileHistory } from '../tools/index.js';
import { lookupFood, lookupBarcode } from '../services/food-lookup.js';
import { linkEntryToFood } from '../services/entry-linking.js';
import { createProviderFromEnv, parseFoodLog } from '../services/llm/index.js';
import { runCoachTurn } from '../services/coach/agent.js';
import { generateOnboardingPlan } from '../services/coach/onboarding-plan.js';
import { generateWeeklyInsights, type WeeklyStats } from '../services/coach/weekly-insights.js';
import { parseMealPhoto } from '../services/coach/photo-parse.js';
import { generateMealSuggestions } from '../services/coach/suggest-meal.js';
import { mealCalorieBand } from '../services/coach/meal-budget.js';
import { getVertexUsage } from '../services/admin/usage.js';
import {
  isPushConfigured,
  pushPublicKey,
  saveSubscription,
  removeSubscription,
  sendPushToUser,
} from '../services/push.js';
import { sendReminderNow } from '../services/reminders.js';
import { UserTrackingPreferencesRepository } from '../repositories/user-tracking-preferences.repository.js';
import { GoalPlanRepository } from '../repositories/goal-plan.repository.js';
import { DailyActivityRepository as ActivityRepo } from '../repositories/daily-activity.repository.js';
import { buildDeficitSeries, buildGlidePath, planProgress, weeklyDeficit } from '../services/goal-progress.js';
import { DailyActivityRepository } from '../repositories/daily-activity.repository.js';
import { extractBearerToken, verifyBearerToken } from '../auth/token-auth.js';

interface ApiOptions {
  env: AppEnv;
  sessionTtlHours: number;
  secureCookies: boolean;
}

type AuthenticatedRequest = Request & {
  sessionUser?: SessionUser;
};

const signupSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  next: z.string().optional(),
});

const entryCreateSchema = z.object({
  food_name: z.string().min(1),
  calories: z.number().int().min(0),
  protein_g: z.number().min(0).optional(),
  carbs_g: z.number().min(0).optional(),
  fat_g: z.number().min(0).optional(),
  meal_type: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).optional(),
  entry_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  food_id: z.string().uuid().optional(),
  quantity: z.number().positive().max(10000).optional(),
  unit: z.string().max(20).optional(),
});

const goalPlanSchema = z.object({
  start_weight_kg: z.number().min(20).max(400),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  goal_weight_kg: z.number().min(20).max(400),
  target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tolerance_kg: z.number().min(0.05).max(3).default(0.3),
  daily_step_goal: z.number().int().min(0).max(100000).nullish(),
  weekly_training_days: z.number().int().min(0).max(7).nullish(),
  // Macro goals live in preferences; accepted here so one save updates both.
  daily_calorie_goal: z.number().int().min(800).max(8000).nullish(),
  daily_protein_goal_g: z.number().min(0).max(500).nullish(),
  daily_carbs_goal_g: z.number().min(0).max(1000).nullish(),
  daily_fat_goal_g: z.number().min(0).max(500).nullish(),
}).refine((v) => v.target_date > v.start_date, {
  message: 'Target date must be after the start date',
});

const coachChatSchema = z.object({
  message: z.string().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(['user', 'model']), parts: z.array(z.any()) }))
    .max(30)
    .optional(),
  // The date the user is viewing in the app; the agent defaults dated actions
  // (logging food, weigh-ins, "what did I eat") to it unless told otherwise.
  active_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /**
   * Answer as newline-delimited JSON, emitting a `step` line per round of tool
   * calls so the app can say what it is waiting on. Opt-in, because every
   * already-installed build expects a single JSON object and would choke on a
   * stream — the response shape must stay the client's choice, not the
   * server's.
   */
  stream: z.boolean().optional(),
});

const aiParseSchema = z.object({
  message: z.string().min(1).max(2000),
});

const activitySchema = z.object({
  activity_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // Bounds are generous but finite: Health can emit odd values, and a garbage
  // step count would distort every chart built on it.
  steps: z.number().int().min(0).max(200000).nullish(),
  active_energy_kcal: z.number().min(0).max(20000).nullish(),
  resting_energy_kcal: z.number().min(0).max(20000).nullish(),
  exercise_minutes: z.number().int().min(0).max(1440).nullish(),
  // Hand-logged exercise: what it was, and the net energy above resting. Kept
  // apart from active_energy_kcal, which a health app pushes and which the
  // deficit deliberately ignores (see services/goal-progress.ts).
  exercise_type: z.string().min(1).max(40).nullish(),
  exercise_kcal: z.number().int().min(0).max(10000).nullish(),
  stand_hours: z.number().int().min(0).max(24).nullish(),
  distance_km: z.number().min(0).max(500).nullish(),
  // Apple Health body mass is stored separately so the Goals view can surface
  // the latest weigh-in without mixing it into activity totals.
  weight_kg: z.number().min(1).max(1000).nullish(),
  source: z.enum(['apple_health', 'manual']).default('apple_health'),
})
  // Reject unknown keys rather than ignoring them. This payload is assembled
  // by hand in Shortcuts, where a typo like "excercise_minutes" would
  // otherwise be silently dropped every night while the request still
  // returned success — the metric would just never appear.
  .strict();

const preferencesSchema = z.object({
  display_name: z.string().min(1).max(100).optional(),
  daily_calorie_goal: z.number().int().min(800).max(8000),
  daily_protein_goal_g: z.number().min(0).max(500),
  daily_carbs_goal_g: z.number().min(0).max(1000),
  daily_fat_goal_g: z.number().min(0).max(500),
});

/** Shared shape for the profile inputs collected during onboarding. */
const onboardingProfileSchema = z.object({
  gender: z.enum(['male', 'female']),
  age: z.number().int().min(13).max(100),
  height_cm: z.number().min(120).max(230),
  weight_kg: z.number().min(30).max(400),
  activity_level: z.enum(['sedentary', 'light', 'moderate', 'active', 'very_active']),
  goal: z.enum(['cut', 'maintain', 'lean_bulk', 'bulk']),
});

// The Vertex plan step: profile + the app's computed baseline, returns refined
// targets + a coaching note. Baseline is echoed so the model can anchor to it.
const aiPlanSchema = onboardingProfileSchema.extend({
  display_name: z.string().max(100).optional(),
  target_weight_kg: z.number().min(30).max(400).nullish(),
  target_rate_kg_per_week: z.number().min(0).max(2).nullish(),
  bmr: z.number().min(500).max(5000),
  tdee: z.number().min(600).max(8000),
  baseline: z.object({
    calories: z.number(),
    protein_g: z.number(),
    carbs_g: z.number(),
    fat_g: z.number(),
  }),
});

// The final commit: saves profile, preferences (with the AI note) and, if a
// target weight is given, a glide-path plan for the Plan tab.
const onboardingCompleteSchema = onboardingProfileSchema.extend({
  display_name: z.string().min(1).max(100),
  daily_calorie_goal: z.number().int().min(800).max(8000),
  daily_protein_goal_g: z.number().min(0).max(500),
  daily_carbs_goal_g: z.number().min(0).max(1000),
  daily_fat_goal_g: z.number().min(0).max(500),
  behavior_instructions: z.string().max(4000).optional(),
  target_weight_kg: z.number().min(30).max(400).nullish(),
  target_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
});

const pushSubscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

const suggestionsQuerySchema = z.object({
  meal: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

const foodCreateSchema = z.object({
  canonical_name: z.string().min(1).max(200),
  reference_unit: z.string().min(1).max(20),
  // Per-unit values, so an implausible number here would scale into every
  // future entry made from this food.
  calories_per_unit: z.number().min(0).max(1000),
  protein_g_per_unit: z.number().min(0).max(100).optional(),
  carbs_g_per_unit: z.number().min(0).max(100).optional(),
  fat_g_per_unit: z.number().min(0).max(100).optional(),
  default_quantity: z.number().positive().max(10000).default(1),
  source: z.enum(['curated_cache', 'openfoodfacts', 'usda', 'manual']).default('manual'),
});

const entryUpdateSchema = z
  .object({
    food_name: z.string().min(1).optional(),
    calories: z.number().int().min(0).optional(),
    // Nullable: clients clear a macro by sending null. Rejecting null failed the
    // *whole* patch, so editing the calories of an entry logged without macros
    // 400'd and the edit was silently lost.
    protein_g: z.number().min(0).nullable().optional(),
    carbs_g: z.number().min(0).nullable().optional(),
    fat_g: z.number().min(0).nullable().optional(),
    meal_type: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).optional(),
    quantity: z.number().positive().max(10000).optional(),
    unit: z.string().min(1).max(20).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

function parseToolResult(result: {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}): { error?: string; payload?: unknown } {
  const text = result.content?.[0]?.text || '';

  if (result.isError) {
    return { error: text || 'Operation failed' };
  }

  try {
    return { payload: JSON.parse(text) };
  } catch {
    return { payload: { message: text } };
  }
}

export function registerApiRoutes(app: Express, options: ApiOptions): void {
  const { env } = options;

  const requireSession = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    const sessionId = getSessionIdFromCookie(req.headers.cookie);

    if (!sessionId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const user = await getSessionUser(env.DB, sessionId);
    if (!user) {
      clearSessionCookie(res, options.secureCookies);
      res.status(401).json({ error: 'Session expired or invalid' });
      return;
    }

    req.sessionUser = user;
    next();
  };

  app.get('/api/auth/config', (_req, res) => {
    // Public: lets the login screen decide whether to show the Google button.
    res.json({ googleClientId: process.env.GOOGLE_OAUTH_CLIENT_ID || null });
  });

  app.post('/api/auth/google', async (req, res) => {
    try {
      const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
      if (!clientId) {
        res.status(503).json({ error: 'Google sign-in is not configured on this server.' });
        return;
      }

      const credential = typeof req.body?.credential === 'string' ? req.body.credential : '';
      if (!credential) {
        res.status(400).json({ error: 'Missing Google credential.' });
        return;
      }

      // Verify the ID token with Google and confirm it was issued for our app.
      const info = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
      ).then((r) => (r.ok ? r.json() : null)) as
        | { aud?: string; email?: string; email_verified?: string | boolean; name?: string }
        | null;

      if (!info || info.aud !== clientId) {
        res.status(401).json({ error: 'Invalid Google credential.' });
        return;
      }
      if (info.email_verified !== 'true' && info.email_verified !== true) {
        res.status(401).json({ error: 'Your Google email is not verified.' });
        return;
      }

      const email = (info.email || '').trim().toLowerCase();
      const name = info.name || email.split('@')[0] || 'You';
      if (!email) {
        res.status(401).json({ error: 'Google did not return an email.' });
        return;
      }

      let user = await env.DB
        .prepare('SELECT id, name, email FROM users WHERE email = ? COLLATE NOCASE')
        .bind(email)
        .first<{ id: string; name: string; email: string }>();

      if (!user) {
        // New Google account — no password row (they sign in with Google).
        const userId = randomUUID();
        await env.DB
          .prepare(
            'INSERT INTO users (id, name, email, role, created_at, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)'
          )
          .bind(userId, name, email, 'user')
          .run();
        user = { id: userId, name, email };
      }

      const session = await createSession(env.DB, user.id, options.sessionTtlHours);
      setSessionCookie(res, session.sessionId, session.expiresAt, options.secureCookies);
      res.json({ user: { id: user.id, name: user.name, email: user.email } });
    } catch (error) {
      console.error('Google auth error:', error);
      res.status(500).json({ error: 'Google sign-in failed. Try again.' });
    }
  });

  app.post('/api/auth/signup', async (req, res) => {
    try {
      const parsed = signupSchema.safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({ error: humanValidationError(parsed.error) });
        return;
      }

      const { name, password } = parsed.data;
      // Emails are matched case-insensitively, so store them lowercased —
      // "Ketan@x.com" and "ketan@x.com" must be the same account.
      const email = parsed.data.email.trim().toLowerCase();

      const existing = await env.DB
        .prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE')
        .bind(email)
        .first<{ id: string }>();

      if (existing) {
        res.status(409).json({ error: 'Email already registered' });
        return;
      }

      const userId = randomUUID();
      await env.DB
        .prepare(
          'INSERT INTO users (id, name, email, role, created_at, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)'
        )
        .bind(userId, name, email, 'user')
        .run();

      await env.DB
        .prepare(
          'INSERT INTO user_passwords (user_id, password_hash, created_at, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)'
        )
        .bind(userId, createPasswordHash(password))
        .run();

      const session = await createSession(env.DB, userId, options.sessionTtlHours);
      setSessionCookie(res, session.sessionId, session.expiresAt, options.secureCookies);

      res.status(201).json({
        user: { id: userId, name, email, role: 'user' },
      });
    } catch (error) {
      console.error('Signup error:', error);
      res.status(500).json({ error: 'Failed to create account' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const parsed = loginSchema.safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({ error: humanValidationError(parsed.error) });
        return;
      }

      const { password, next } = parsed.data;
      const email = parsed.data.email.trim().toLowerCase();

      const user = await env.DB
        .prepare('SELECT id, name, email, role FROM users WHERE email = ? COLLATE NOCASE')
        .bind(email)
        .first<{ id: string; name: string; email: string; role: string }>();

      if (!user) {
        res.status(401).json({ error: 'Invalid email or password' });
        return;
      }

      const passwordRecord = await env.DB
        .prepare('SELECT password_hash FROM user_passwords WHERE user_id = ?')
        .bind(user.id)
        .first<{ password_hash: string }>();

      if (!passwordRecord || !verifyPassword(password, passwordRecord.password_hash)) {
        res.status(401).json({ error: 'Invalid email or password' });
        return;
      }

      const session = await createSession(env.DB, user.id, options.sessionTtlHours);
      setSessionCookie(res, session.sessionId, session.expiresAt, options.secureCookies);

      res.json({
        user,
        next: next || '/dashboard',
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ error: 'Failed to sign in' });
    }
  });

  app.post('/api/auth/logout', async (req, res) => {
    try {
      const sessionId = getSessionIdFromCookie(req.headers.cookie);
      if (sessionId) {
        await destroySession(env.DB, sessionId);
      }

      clearSessionCookie(res, options.secureCookies);
      res.json({ success: true });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({ error: 'Failed to sign out' });
    }
  });

  // Permanently delete the signed-in user's account and ALL their data. The
  // owner/admin account is protected here (delete it via the DB if ever needed)
  // so it can't be wiped by accident. Table list is a fixed allowlist — no user
  // input reaches the SQL.
  app.delete('/api/account', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const user = req.sessionUser!;
      if (user.isAdmin) {
        res.status(403).json({ error: 'The owner account cannot be deleted from the app.' });
        return;
      }
      const userId = user.userId;
      const USER_TABLES = [
        'user_passwords',
        'web_sessions',
        'food_entries',
        'user_profiles',
        'profile_tracking',
        'oauth_clients',
        'oauth_authorization_codes',
        'oauth_tokens',
        'body_measurements',
        'progress_photos',
        'user_tracking_preferences',
        'food_aliases',
        'foods',
        'daily_activity',
        'goal_plans',
        'push_subscriptions',
        'weekly_reports',
      ];
      for (const table of USER_TABLES) {
        await env.DB.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(userId).run();
      }
      await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();

      clearSessionCookie(res, options.secureCookies);
      res.json({ ok: true });
    } catch (error) {
      console.error('Delete account error:', error);
      res.status(500).json({ error: 'Failed to delete the account.' });
    }
  });

  app.get('/api/me', requireSession, async (req: AuthenticatedRequest, res) => {
    const user = req.sessionUser!;

    // Goals live in user_tracking_preferences and are editable through the MCP
    // connector, so the app must read them rather than hardcode a copy that
    // silently drifts out of date.
    const prefs = await env.DB
      .prepare(
        `SELECT daily_calorie_goal, daily_protein_goal_g, daily_carbs_goal_g, daily_fat_goal_g
         FROM user_tracking_preferences WHERE user_id = ?`
      )
      .bind(user.userId)
      .first<{
        daily_calorie_goal: number | null;
        daily_protein_goal_g: number | null;
        daily_carbs_goal_g: number | null;
        daily_fat_goal_g: number | null;
      }>();

    res.json({
      id: user.userId,
      name: user.name,
      email: user.email,
      role: user.isAdmin ? 'admin' : 'user',
      // A user is "onboarded" once they've set a calorie target. New signups
      // have no preferences row, so this is false and the app shows onboarding.
      onboarded: prefs?.daily_calorie_goal != null,
      goals: {
        calories: prefs?.daily_calorie_goal ?? null,
        protein_g: prefs?.daily_protein_goal_g ?? null,
        carbs_g: prefs?.daily_carbs_goal_g ?? null,
        fat_g: prefs?.daily_fat_goal_g ?? null,
      },
    });
  });

  app.get('/api/entries', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const date =
        typeof req.query.date === 'string'
          ? req.query.date
          : new Date().toISOString().split('T')[0];
      const limit = Number(req.query.limit || '100');
      const offset = Number(req.query.offset || '0');

      const repository = new FoodEntryRepository(env.DB);
      const entries = await repository.findByUserAndDate(req.sessionUser!.userId, {
        date,
        limit,
        offset,
      });

      const totals = entries.reduce(
        (acc, entry) => {
          acc.calories += entry.calories;
          acc.protein_g += entry.protein_g || 0;
          acc.carbs_g += entry.carbs_g || 0;
          acc.fat_g += entry.fat_g || 0;
          return acc;
        },
        { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
      );

      res.json({ date, entries, totals });
    } catch (error) {
      console.error('List entries error:', error);
      res.status(500).json({ error: 'Failed to list entries' });
    }
  });

  app.post('/api/entries', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const parsed = entryCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: humanValidationError(parsed.error) });
        return;
      }

      const userId = req.sessionUser!.userId;

      // Callers that already know the food (the PWA) pass food_id; anything
      // sending free text gets resolved here so the entry still counts toward
      // future suggestions.
      const linked = await linkEntryToFood(env.DB, userId, parsed.data);

      const repository = new FoodEntryRepository(env.DB);
      const entryId = await repository.create(linked, userId);

      res.status(201).json({ entry_id: entryId, food_id: linked.food_id ?? null });
    } catch (error) {
      console.error('Create entry error:', error);
      res.status(500).json({ error: 'Failed to create entry' });
    }
  });

  app.get('/api/suggestions', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const parsed = suggestionsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: humanValidationError(parsed.error) });
        return;
      }

      const repository = new FoodLibraryRepository(env.DB);
      const suggestions = await repository.suggestForMeal(
        req.sessionUser!.userId,
        parsed.data.meal as MealType,
        parsed.data.limit
      );

      res.json({ meal_type: parsed.data.meal, suggestions });
    } catch (error) {
      console.error('Suggestions error:', error);
      res.status(500).json({ error: 'Failed to load suggestions' });
    }
  });

  app.get('/api/stats/weekly', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      const days = Math.min(90, Math.max(7, Number(req.query.days || '30')));
      const repository = new FoodEntryRepository(env.DB);
      const daily = await repository.getDailyTotals(req.sessionUser!.userId, days);

      // A day only counts toward the streak if enough was logged to be a real
      // day's record. The history contains days with a single 240 kcal entry —
      // those are abandoned logs, not fasts, and counting them would make the
      // streak flatter.
      const COMPLETE_DAY_KCAL = 1200;
      const logged = new Set(daily.filter((d) => d.calories >= COMPLETE_DAY_KCAL).map((d) => d.entry_date));

      let streak = 0;
      const cursor = new Date();
      // Today doesn't break the streak until it ends, so start from today only
      // if it already qualifies, otherwise from yesterday.
      if (!logged.has(cursor.toISOString().split('T')[0]!)) {
        cursor.setDate(cursor.getDate() - 1);
      }
      while (logged.has(cursor.toISOString().split('T')[0]!)) {
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
      }

      const complete = daily.filter((d) => d.calories >= COMPLETE_DAY_KCAL);
      const average =
        complete.length > 0
          ? Math.round(complete.reduce((sum, d) => sum + d.calories, 0) / complete.length)
          : 0;

      res.json({
        days,
        daily,
        streak,
        days_logged: daily.length,
        complete_days: complete.length,
        average_calories: average,
        complete_day_threshold: COMPLETE_DAY_KCAL,
      });
    } catch (error) {
      console.error('Weekly stats error:', error);
      res.status(500).json({ error: 'Failed to load stats' });
    }
  });

  /**
   * Accepts a session cookie OR a bearer API token. The Apple Shortcuts
   * automation that pushes Health data can send a header but cannot hold a
   * browser session, so token auth is required here.
   */
  const requireSessionOrToken = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    const authHeader = req.headers.authorization;

    // A header that's present but not "Bearer <token>" is almost always a
    // client sending the raw token. Say so: falling through to the generic
    // "Authentication required" gives no clue what's wrong.
    if (authHeader && !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error:
          'Authorization header must be "Bearer <token>" — it looks like the "Bearer " prefix is missing.',
      });
      return;
    }

    const token = extractBearerToken(authHeader);
    if (token) {
      const user = await verifyBearerToken(env.DB, token);
      if (!user) {
        res.status(401).json({ error: 'Invalid or expired token' });
        return;
      }
      req.sessionUser = {
        userId: user.userId,
        isAdmin: user.isAdmin,
        name: '',
        email: '',
      };
      next();
      return;
    }

    await requireSession(req, res, next);
  };

  app.post('/api/activity', requireSessionOrToken, async (req: AuthenticatedRequest, res) => {
    try {
      const parsed = activitySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: humanValidationError(parsed.error) });
        return;
      }

      const { weight_kg, ...activity } = parsed.data;
      const repository = new DailyActivityRepository(env.DB);

      await repository.upsert(req.sessionUser!.userId, activity);

      if (weight_kg !== null && weight_kg !== undefined) {
        const userId = req.sessionUser!.userId;
        const profileTrackingRepo = new ProfileTrackingRepository(env.DB);
        const existingTracking = await profileTrackingRepo.getTrackingByDate(
          userId,
          activity.activity_date
        );

        if (existingTracking) {
          await profileTrackingRepo.updateTracking(existingTracking.id, {
            weight_kg,
            recorded_date: activity.activity_date,
          });
        } else {
          await profileTrackingRepo.createTracking({
            user_id: userId,
            recorded_date: activity.activity_date,
            weight_kg,
          });
        }
      }

      res.status(200).json({ ok: true, activity_date: activity.activity_date });
    } catch (error) {
      console.error('Activity upsert error:', error);
      res.status(500).json({ error: 'Failed to save activity' });
    }
  });

  app.get('/api/activity', requireSessionOrToken, async (req: AuthenticatedRequest, res) => {
    try {
      const days = Math.min(365, Math.max(1, Number(req.query.days || '30')));
      const repository = new DailyActivityRepository(env.DB);
      const activity = await repository.listRecent(req.sessionUser!.userId, days);

      res.json({ days, activity });
    } catch (error) {
      console.error('Activity list error:', error);
      res.status(500).json({ error: 'Failed to load activity' });
    }
  });

  app.get('/api/goals', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.sessionUser!.userId;
      const planRepo = new GoalPlanRepository(env.DB);
      const plan = await planRepo.getActive(userId);

      const prefs = await env.DB
        .prepare(
          `SELECT daily_calorie_goal, daily_protein_goal_g, daily_carbs_goal_g, daily_fat_goal_g
           FROM user_tracking_preferences WHERE user_id = ?`
        )
        .bind(userId)
        .first<Record<string, number | null>>();

      const tracking = await env.DB
        .prepare(
          `SELECT recorded_date, weight_kg, tdee_calories FROM profile_tracking
           WHERE user_id = ? ORDER BY recorded_date ASC`
        )
        .bind(userId)
        .all<{ recorded_date: string; weight_kg: number | null; tdee_calories: number | null }>();

      const weighIns = tracking.results ?? [];
      const glide = plan ? buildGlidePath(plan, weighIns) : [];

      const dailyIntake = await env.DB
        .prepare(
          `SELECT entry_date, SUM(calories) AS calories FROM food_entries
           WHERE user_id = ? AND entry_date >= date('now', '-60 days')
           GROUP BY entry_date`
        )
        .bind(userId)
        .all<{ entry_date: string; calories: number }>();

      // Only days with a plausibly complete log feed the deficit: a day with
      // one 240 kcal entry would otherwise read as a 2600 kcal deficit.
      const intakeByDate = new Map(
        (dailyIntake.results ?? [])
          .filter((row) => row.calories >= 1200)
          .map((row) => [row.entry_date, row.calories] as const)
      );
      const tdeeByDate = new Map(
        weighIns
          .filter((row) => row.tdee_calories !== null)
          .map((row) => [row.recorded_date, row.tdee_calories!] as const)
      );

      const latestTdee = [...tdeeByDate.values()].pop() ?? null;

      const activityRepo = new ActivityRepo(env.DB);
      const activity = await activityRepo.listRecent(userId, 60);

      // Only hand-logged sessions count towards expenditure — see
      // buildDeficitSeries for why health-app active energy does not.
      const exerciseByDate = new Map(
        activity
          .filter((row) => (row.exercise_kcal ?? 0) > 0)
          .map((row) => [row.activity_date, row.exercise_kcal!] as const)
      );
      const deficitDays = buildDeficitSeries(intakeByDate, tdeeByDate, latestTdee, exerciseByDate);

      // Every weigh-in inside the plan (or the recent past when there's no
      // plan), so the app can plot the day-to-day line against the baseline
      // rather than only the weekly markers the glide path exposes.
      const today = new Date().toISOString().split('T')[0]!;
      const windowStart =
        plan?.start_date ?? new Date(Date.now() - 90 * 86_400_000).toISOString().split('T')[0]!;
      const dailyWeights = weighIns
        .filter((row) => row.weight_kg !== null && row.recorded_date >= windowStart)
        .map((row) => ({ recorded_date: row.recorded_date, weight_kg: row.weight_kg! }));

      res.json({
        plan,
        weigh_ins: dailyWeights,
        progress: plan ? planProgress(plan, weighIns, today) : null,
        macros: {
          calories: prefs?.daily_calorie_goal ?? null,
          protein_g: prefs?.daily_protein_goal_g ?? null,
          carbs_g: prefs?.daily_carbs_goal_g ?? null,
          fat_g: prefs?.daily_fat_goal_g ?? null,
        },
        glide_path: glide,
        weekly_deficit: weeklyDeficit(deficitDays),
        latest_weight:
          [...weighIns].reverse().find((row) => row.weight_kg !== null)?.weight_kg ?? null,
        activity,
      });
    } catch (error) {
      console.error('Goals load error:', error);
      res.status(500).json({ error: 'Failed to load goals' });
    }
  });

  app.put('/api/goals', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const parsed = goalPlanSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: humanValidationError(parsed.error) });
        return;
      }

      const userId = req.sessionUser!.userId;
      const planRepo = new GoalPlanRepository(env.DB);
      await planRepo.replaceActive(userId, parsed.data);

      // Macro goals are shared with the MCP connector, so only overwrite the
      // fields actually supplied rather than blanking the rest.
      const macros = parsed.data;
      if (
        macros.daily_calorie_goal != null ||
        macros.daily_protein_goal_g != null ||
        macros.daily_carbs_goal_g != null ||
        macros.daily_fat_goal_g != null
      ) {
        // upsert so a user with no preferences row yet (a fresh signup) gets
        // one created rather than a no-op UPDATE.
        await new UserTrackingPreferencesRepository(env.DB).upsert(userId, {
          daily_calorie_goal: macros.daily_calorie_goal ?? undefined,
          daily_protein_goal_g: macros.daily_protein_goal_g ?? undefined,
          daily_carbs_goal_g: macros.daily_carbs_goal_g ?? undefined,
          daily_fat_goal_g: macros.daily_fat_goal_g ?? undefined,
        });
      }

      res.json({ ok: true });
    } catch (error) {
      console.error('Goals save error:', error);
      res.status(500).json({ error: 'Failed to save goals' });
    }
  });

  app.put('/api/preferences', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const parsed = preferencesSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: humanValidationError(parsed.error) });
        return;
      }

      await new UserTrackingPreferencesRepository(env.DB).upsert(req.sessionUser!.userId, parsed.data);
      res.json({ ok: true });
    } catch (error) {
      console.error('Preferences save error:', error);
      res.status(500).json({ error: 'Failed to save preferences' });
    }
  });

  // Onboarding step: refine the app's computed baseline into a personalised
  // plan via Vertex AI. 503 when Vertex isn't configured so the client silently
  // falls back to its own baseline; 502 on a transient AI failure (same).
  app.post('/api/onboarding/ai-plan', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const parsed = aiPlanSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: humanValidationError(parsed.error) });
        return;
      }

      const credentialJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
      const project = process.env.GCP_PROJECT;
      if (!credentialJson || !project) {
        res.status(503).json({ error: 'AI planning is not configured on this server.' });
        return;
      }

      const plan = await generateOnboardingPlan({
        ...parsed.data,
        target_weight_kg: parsed.data.target_weight_kg ?? null,
        credentialJson,
        project,
        location: process.env.GCP_LOCATION || 'us-central1',
        model: process.env.LLM_MODEL || 'gemini-2.5-flash',
      });

      res.json({ plan });
    } catch (error) {
      console.error('Onboarding AI plan error:', error);
      res.status(502).json({ error: 'Could not generate an AI plan. Using the standard targets.' });
    }
  });

  // Onboarding commit: create the profile (with a first weigh-in), save the
  // daily targets + coaching note, and — if a target weight was given — a
  // glide-path plan so the Plan tab is ready. One call, so a new user is set up
  // atomically from the client's perspective.
  app.post('/api/onboarding/complete', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const parsed = onboardingCompleteSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: humanValidationError(parsed.error) });
        return;
      }
      const userId = req.sessionUser!.userId;
      const d = parsed.data;

      // Profile + first weigh-in (this also records BMR/TDEE from the weight).
      const profileResult = await updateProfile(
        {
          height_cm: d.height_cm,
          age: d.age,
          gender: d.gender,
          activity_level: d.activity_level,
          weight_kg: d.weight_kg,
        },
        userId,
        env
      );
      if (profileResult.isError) {
        const text = profileResult.content?.[0];
        res.status(400).json({
          error: text && text.type === 'text' ? (text as { text: string }).text : 'Could not save profile.',
        });
        return;
      }

      // Daily targets + the AI coaching note (behavior_instructions is what the
      // Coach reads on every turn).
      await new UserTrackingPreferencesRepository(env.DB).upsert(userId, {
        display_name: d.display_name,
        daily_calorie_goal: d.daily_calorie_goal,
        daily_protein_goal_g: d.daily_protein_goal_g,
        daily_carbs_goal_g: d.daily_carbs_goal_g,
        daily_fat_goal_g: d.daily_fat_goal_g,
        behavior_instructions: d.behavior_instructions || undefined,
      });

      // Optional glide-path plan for the Plan tab.
      if (d.target_weight_kg && d.target_date) {
        const today = new Date().toLocaleDateString('en-CA');
        await new GoalPlanRepository(env.DB).replaceActive(userId, {
          start_weight_kg: d.weight_kg,
          start_date: today,
          goal_weight_kg: d.target_weight_kg,
          target_date: d.target_date,
        });
      }

      res.json({ ok: true });
    } catch (error) {
      console.error('Onboarding complete error:', error);
      res.status(500).json({ error: 'Could not finish setting up your account.' });
    }
  });

  // ── Web Push ────────────────────────────────────────────────────────────
  // The client needs the VAPID public key to subscribe; null means the feature
  // is off on this server and the UI hides the toggle.
  app.get('/api/push/config', requireSession, (_req: AuthenticatedRequest, res) => {
    res.json({ publicKey: pushPublicKey() });
  });

  app.post('/api/push/subscribe', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      if (!isPushConfigured()) {
        res.status(503).json({ error: 'Push notifications are not configured on this server.' });
        return;
      }
      const parsed = pushSubscribeSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: humanValidationError(parsed.error) });
        return;
      }
      await saveSubscription(env.DB, req.sessionUser!.userId, parsed.data);
      res.json({ ok: true });
    } catch (error) {
      console.error('Push subscribe error:', error);
      res.status(500).json({ error: 'Could not save the subscription.' });
    }
  });

  app.post('/api/push/unsubscribe', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : '';
      if (endpoint) await removeSubscription(env.DB, endpoint);
      res.json({ ok: true });
    } catch (error) {
      console.error('Push unsubscribe error:', error);
      res.status(500).json({ error: 'Could not remove the subscription.' });
    }
  });

  // Fires a notification to the user's own devices — used right after they
  // enable notifications so they see it working immediately.
  app.post('/api/push/test', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const delivered = await sendPushToUser(env.DB, req.sessionUser!.userId, {
        title: 'NutriAI',
        body: "Notifications are on 🎉 I'll nudge you to log your meals.",
        url: '/app/',
        tag: 'nutriai-test',
      });
      res.json({ ok: true, delivered });
    } catch (error) {
      console.error('Push test error:', error);
      res.status(500).json({ error: 'Could not send a test notification.' });
    }
  });

  // Sends the user the exact daily reminder they'd get tonight, computed from
  // today's log — lets them preview the personalised content on demand.
  app.post('/api/push/preview-reminder', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const delivered = await sendReminderNow(env, req.sessionUser!.userId);
      res.json({ ok: true, delivered });
    } catch (error) {
      console.error('Push preview error:', error);
      res.status(500).json({ error: 'Could not send a sample reminder.' });
    }
  });

  app.get('/api/ai/status', requireSession, (_req: AuthenticatedRequest, res) => {
    // Whether the AI logger is usable is purely a deployment-config question
    // (is an API key set), so the client can hide the feature when it isn't.
    res.json({ configured: createProviderFromEnv() !== null });
  });

  app.post('/api/ai/parse', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const parsed = aiParseSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: humanValidationError(parsed.error) });
        return;
      }

      const provider = createProviderFromEnv();
      if (!provider) {
        res.status(503).json({ error: 'AI logging is not configured on this server.' });
        return;
      }

      const userId = req.sessionUser!.userId;

      // Give the model the user's most-logged foods so it reuses their verified
      // macros rather than estimating from scratch.
      const known = await env.DB
        .prepare(
          `SELECT f.canonical_name, f.reference_unit, f.calories_per_unit, f.protein_g_per_unit,
                  COUNT(e.id) AS n
           FROM foods f LEFT JOIN food_entries e ON e.food_id = f.id
           WHERE f.user_id = ?
           GROUP BY f.id ORDER BY n DESC LIMIT 25`
        )
        .bind(userId)
        .all<{
          canonical_name: string;
          reference_unit: string;
          calories_per_unit: number;
          protein_g_per_unit: number | null;
        }>();

      const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local
      const result = await parseFoodLog(provider, parsed.data.message, {
        today,
        knownFoods: (known.results ?? []).map((f) => ({
          name: f.canonical_name,
          unit: f.reference_unit,
          calories_per_unit: f.calories_per_unit,
          protein_per_unit: f.protein_g_per_unit,
        })),
      });

      // Deliberately does NOT log anything. The parsed items go back to the
      // client for confirmation, and only a subsequent POST /api/entries writes
      // to the log — an LLM misread should never silently corrupt the diary.
      res.json(result);
    } catch (error) {
      console.error('AI parse error:', error);
      res.status(502).json({
        error: 'The AI service could not be reached. Try again, or add the food manually.',
      });
    }
  });

  // Photo meal logging: Gemini vision identifies foods + macros from a photo.
  // Returns items for confirmation only (never logs) — same safety rule as parse.
  app.post('/api/ai/photo', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const credentialJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
      const project = process.env.GCP_PROJECT;
      if (!credentialJson || !project) {
        res.status(503).json({ error: 'Photo logging needs Vertex AI configured on the server.' });
        return;
      }

      const raw = typeof req.body?.image === 'string' ? req.body.image : '';
      // Accept a data URL ("data:image/jpeg;base64,....") or bare base64.
      const match = raw.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
      const mimeType = match ? match[1] : 'image/jpeg';
      const imageBase64 = match ? match[2] : raw;
      if (!imageBase64 || imageBase64.length < 100) {
        res.status(400).json({ error: 'No image provided.' });
        return;
      }

      const userId = req.sessionUser!.userId;
      const known = await env.DB
        .prepare(
          `SELECT f.canonical_name, f.reference_unit, f.calories_per_unit, f.protein_g_per_unit,
                  COUNT(e.id) AS n
           FROM foods f LEFT JOIN food_entries e ON e.food_id = f.id
           WHERE f.user_id = ? GROUP BY f.id ORDER BY n DESC LIMIT 25`
        )
        .bind(userId)
        .all<{ canonical_name: string; reference_unit: string; calories_per_unit: number; protein_g_per_unit: number | null }>();
      const knownFoods = (known.results ?? [])
        .map(
          (f) =>
            `- ${f.canonical_name}: ${f.calories_per_unit} kcal/${f.reference_unit}` +
            (f.protein_g_per_unit !== null ? `, ${f.protein_g_per_unit}g protein/${f.reference_unit}` : '')
        )
        .join('\n');

      const result = await parseMealPhoto({
        imageBase64,
        mimeType,
        knownFoods,
        credentialJson,
        project,
        location: process.env.GCP_LOCATION || 'us-central1',
        model: process.env.LLM_MODEL || 'gemini-2.5-flash',
      });

      res.json(result);
    } catch (error) {
      console.error('AI photo error:', error);
      res.status(502).json({ error: 'Could not read the photo. Try again or add the food manually.' });
    }
  });

  app.post('/api/coach/chat', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const parsed = coachChatSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: humanValidationError(parsed.error) });
        return;
      }

      // The agent drives Vertex directly (function calling), so it needs the
      // Vertex credentials — not just any LLM provider.
      const credentialJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
      const project = process.env.GCP_PROJECT;
      if (!credentialJson || !project) {
        res.status(503).json({ error: 'The Coach assistant needs Vertex AI configured on the server.' });
        return;
      }

      const userId = req.sessionUser!.userId;
      const known = await env.DB
        .prepare(
          `SELECT f.canonical_name, f.reference_unit, f.calories_per_unit, f.protein_g_per_unit,
                  COUNT(e.id) AS n
           FROM foods f LEFT JOIN food_entries e ON e.food_id = f.id
           WHERE f.user_id = ?
           GROUP BY f.id ORDER BY n DESC LIMIT 25`
        )
        .bind(userId)
        .all<{ canonical_name: string; reference_unit: string; calories_per_unit: number; protein_g_per_unit: number | null }>();

      const knownFoods = (known.results ?? [])
        .map(
          (f) =>
            `- ${f.canonical_name}: ${f.calories_per_unit} kcal/${f.reference_unit}` +
            (f.protein_g_per_unit !== null ? `, ${f.protein_g_per_unit}g protein/${f.reference_unit}` : '')
        )
        .join('\n');

      /**
       * Streaming mode: newline-delimited JSON, one `step` line per round of
       * tool calls, then a final `done` line carrying the same object the
       * non-streaming path returns.
       *
       * Why it matters: a turn that logs a meal spends 30-60 seconds in the
       * agent loop, and the client could previously show nothing but a
       * spinner. The steps are the tool calls the agent is actually about to
       * make, so the progress the user sees is the work being done rather
       * than a timer pretending.
       *
       * Headers are flushed before the first step so the connection is
       * established while the model is still thinking; `X-Accel-Buffering:no`
       * asks any proxy in front not to hold the chunks back until the end,
       * which would defeat the whole thing.
       */
      const streaming = parsed.data.stream === true;
      if (streaming) {
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
      }

      const result = await runCoachTurn({
        message: parsed.data.message,
        history: (parsed.data.history ?? []) as never,
        userId,
        env,
        knownFoods,
        activeDate: parsed.data.active_date,
        credentialJson,
        project,
        location: process.env.GCP_LOCATION || 'us-central1',
        model: process.env.LLM_MODEL || 'gemini-2.5-flash',
        onStep: streaming
          ? (tools) => {
              // Best-effort: a client that has gone away must not take the
              // turn down with it — the entries it asked for are already
              // being written.
              try {
                res.write(`${JSON.stringify({ type: 'step', tools })}\n`);
              } catch {
                /* ignore */
              }
            }
          : undefined,
      });

      if (streaming) {
        res.write(`${JSON.stringify({ type: 'done', ...result })}\n`);
        res.end();
        return;
      }
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const rateLimited = message.includes('429');
      const status = rateLimited ? 429 : 502;
      const text = rateLimited
        ? "The AI is busy right now — give it a few seconds and try again."
        : 'The Coach could not be reached. Try again in a moment.';
      if (!rateLimited) console.error('Coach chat error:', error);

      // Once streaming has begun the status line is long gone, so the failure
      // has to travel as a final line instead of an HTTP code.
      if (res.headersSent) {
        res.write(`${JSON.stringify({ type: 'error', error: text })}\n`);
        res.end();
        return;
      }
      res.status(status).json({ error: text });
    }
  });

  // "What should I eat?" — 3 simple Indian meal ideas that fit the calories left
  // today and the user's diet notes.
  app.post('/api/ai/suggest-meal', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const credentialJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
      const project = process.env.GCP_PROJECT;
      if (!credentialJson || !project) {
        res.status(503).json({ error: 'Meal suggestions need Vertex AI configured on the server.' });
        return;
      }
      const userId = req.sessionUser!.userId;
      const mealType = ['breakfast', 'lunch', 'dinner', 'snack'].includes(req.body?.meal_type)
        ? (req.body.meal_type as string)
        : 'meal';
      const date = new Date().toISOString().slice(0, 10);

      const consumed = await env.DB
        .prepare(
          `SELECT COALESCE(SUM(calories),0) cal, COALESCE(SUM(protein_g),0) pro
           FROM food_entries WHERE user_id = ? AND entry_date = ?`
        )
        .bind(userId, date)
        .first<{ cal: number; pro: number }>();

      // What they've already eaten today, so the same dish isn't suggested
      // back to them, plus anything the client says it has already shown.
      const eatenRows = await env.DB
        .prepare(`SELECT food_name FROM food_entries WHERE user_id = ? AND entry_date = ? LIMIT 20`)
        .bind(userId, date)
        .all<{ food_name: string }>();
      const alreadyShown = Array.isArray(req.body?.exclude)
        ? (req.body.exclude as unknown[]).filter((n): n is string => typeof n === 'string').slice(0, 15)
        : [];
      const avoid = [...(eatenRows?.results ?? []).map((r) => r.food_name), ...alreadyShown];
      const prefs = await env.DB
        .prepare(
          `SELECT daily_calorie_goal, daily_protein_goal_g, behavior_instructions
           FROM user_tracking_preferences WHERE user_id = ?`
        )
        .bind(userId)
        .first<{
          daily_calorie_goal: number | null;
          daily_protein_goal_g: number | null;
          behavior_instructions: string | null;
        }>();

      // No floor: a day that's already spent must report as spent. Flooring
      // this at 150 made being 400 kcal over look identical to having 150
      // left, so the suggestions never adapted at the one point they matter
      // most. mealCalorieBand handles the negative case explicitly.
      const remainingCalories =
        prefs?.daily_calorie_goal != null
          ? prefs.daily_calorie_goal - Math.round(consumed?.cal ?? 0)
          : null;
      const remainingProtein =
        prefs?.daily_protein_goal_g != null
          ? Math.max(0, prefs.daily_protein_goal_g - Math.round(consumed?.pro ?? 0))
          : null;

      const suggestions = await generateMealSuggestions({
        remainingCalories,
        remainingProtein,
        mealType,
        avoid,
        dietNotes: prefs?.behavior_instructions ? prefs.behavior_instructions.slice(0, 400) : null,
        credentialJson,
        project,
        location: process.env.GCP_LOCATION || 'us-central1',
        model: process.env.LLM_MODEL || 'gemini-2.5-flash',
      });

      const band = mealCalorieBand({
        remainingCalories,
        remainingProtein,
        mealType: mealType as Parameters<typeof mealCalorieBand>[0]['mealType'],
      });

      res.json({
        meal_type: mealType,
        remaining_calories: remainingCalories,
        remaining_protein: remainingProtein,
        // So the sheet can say what it aimed for, rather than leaving the user
        // to wonder why the numbers look small.
        target_band: band ? { min: band.min, max: band.max, target: band.target } : null,
        over_budget: band?.overBudget ?? false,
        suggestions,
      });
    } catch (error) {
      console.error('Suggest meal error:', error);
      res.status(502).json({ error: 'Could not get suggestions right now. Try again.' });
    }
  });

  // Barcode → packaged product macros via Open Food Facts.
  app.get('/api/foods/barcode', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const code = typeof req.query.code === 'string' ? req.query.code.replace(/\D/g, '') : '';
      if (code.length < 6 || code.length > 14) {
        res.status(400).json({ error: 'Invalid barcode.' });
        return;
      }
      const product = await lookupBarcode(code);
      res.json(product);
    } catch (error) {
      console.error('Barcode lookup error:', error);
      res.status(502).json({ error: 'Could not look up that barcode.' });
    }
  });

  app.get('/api/foods/search', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      if (query.length < 2) {
        res.status(400).json({ error: 'Query must be at least 2 characters' });
        return;
      }

      const repository = new FoodLibraryRepository(env.DB);
      const foods = await repository.search(req.sessionUser!.userId, query);

      res.json({ query, foods });
    } catch (error) {
      console.error('Food search error:', error);
      res.status(500).json({ error: 'Failed to search foods' });
    }
  });

  app.get('/api/foods/lookup', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      if (query.length < 2) {
        res.status(400).json({ error: 'Query must be at least 2 characters' });
        return;
      }

      const results = await lookupFood(query);
      res.json({ query, results });
    } catch (error) {
      // lookupFood already degrades to an empty list on provider failure, so
      // reaching here means something unexpected — still answer with an empty
      // set so the user falls through to entering macros manually.
      console.error('Food lookup error:', error);
      res.json({ query: req.query.q, results: [] });
    }
  });

  app.post('/api/foods', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const parsed = foodCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: humanValidationError(parsed.error) });
        return;
      }

      const repository = new FoodLibraryRepository(env.DB);
      const foodId = await repository.upsert(req.sessionUser!.userId, {
        canonical_name: parsed.data.canonical_name,
        reference_unit: parsed.data.reference_unit,
        calories_per_unit: parsed.data.calories_per_unit,
        protein_g_per_unit: parsed.data.protein_g_per_unit ?? null,
        carbs_g_per_unit: parsed.data.carbs_g_per_unit ?? null,
        fat_g_per_unit: parsed.data.fat_g_per_unit ?? null,
        default_quantity: parsed.data.default_quantity,
        source: parsed.data.source,
      });

      res.status(201).json({ food_id: foodId });
    } catch (error) {
      console.error('Create food error:', error);
      res.status(500).json({ error: 'Failed to create food' });
    }
  });

  app.patch('/api/entries/:entryId', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const parsed = entryUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: humanValidationError(parsed.error) });
        return;
      }

      const repository = new FoodEntryRepository(env.DB);
      const updated = await repository.update(
        req.params.entryId,
        req.sessionUser!.userId,
        parsed.data
      );

      if (!updated) {
        res.status(404).json({ error: 'Entry not found' });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Update entry error:', error);
      res.status(500).json({ error: 'Failed to update entry' });
    }
  });

  app.delete('/api/entries/:entryId', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const repository = new FoodEntryRepository(env.DB);
      const deleted = await repository.delete(req.params.entryId, req.sessionUser!.userId);

      if (!deleted) {
        res.status(404).json({ error: 'Entry not found' });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Delete entry error:', error);
      res.status(500).json({ error: 'Failed to delete entry' });
    }
  });

  app.get('/api/profile', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const profileRepo = new UserProfileRepository(env.DB);
      const profile = await profileRepo.getProfileById(req.sessionUser!.userId);

      if (!profile) {
        res.status(404).json({ error: 'Profile not found' });
        return;
      }

      res.json(profile);
    } catch (error) {
      console.error('Get profile error:', error);
      res.status(500).json({ error: 'Failed to load profile' });
    }
  });

  app.put('/api/profile', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const result = await updateProfile(req.body, req.sessionUser!.userId, env);
      const parsed = parseToolResult(result);

      if (parsed.error) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      res.json(parsed.payload);
    } catch (error) {
      console.error('Update profile error:', error);
      res.status(500).json({ error: 'Failed to update profile' });
    }
  });

  app.get('/api/profile/history', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const result = await getProfileHistory(
        {
          date: typeof req.query.date === 'string' ? req.query.date : undefined,
          start_date:
            typeof req.query.start_date === 'string'
              ? req.query.start_date
              : undefined,
          end_date:
            typeof req.query.end_date === 'string' ? req.query.end_date : undefined,
          limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : 30,
          offset: typeof req.query.offset === 'string' ? Number(req.query.offset) : 0,
        },
        req.sessionUser!.userId,
        env
      );

      const parsed = parseToolResult(result);
      if (parsed.error) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      res.json(parsed.payload);
    } catch (error) {
      console.error('Profile history error:', error);
      res.status(500).json({ error: 'Failed to get profile history' });
    }
  });

  app.get('/api/dashboard', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.sessionUser!.userId;
      const date =
        typeof req.query.date === 'string'
          ? req.query.date
          : new Date().toISOString().split('T')[0];

      const foodRepo = new FoodEntryRepository(env.DB);
      const profileRepo = new UserProfileRepository(env.DB);
      const trackingRepo = new ProfileTrackingRepository(env.DB);

      const entries = await foodRepo.findByUserAndDate(userId, { date, limit: 200, offset: 0 });
      const profile = await profileRepo.getProfileById(userId);
      const history = await trackingRepo.getTrackingByUserId(userId, { limit: 14 });

      const totals = entries.reduce(
        (acc, entry) => {
          acc.calories += entry.calories;
          acc.protein_g += entry.protein_g || 0;
          acc.carbs_g += entry.carbs_g || 0;
          acc.fat_g += entry.fat_g || 0;
          return acc;
        },
        { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
      );

      const mealBreakdown = entries.reduce<Record<string, number>>((acc, entry) => {
        const key = entry.meal_type || 'unknown';
        acc[key] = (acc[key] || 0) + entry.calories;
        return acc;
      }, {});

      res.json({
        user: {
          id: userId,
          name: req.sessionUser!.name,
          email: req.sessionUser!.email,
        },
        date,
        totals,
        meal_breakdown: mealBreakdown,
        entries,
        profile,
        recent_tracking: history,
      });
    } catch (error) {
      console.error('Dashboard error:', error);
      res.status(500).json({ error: 'Failed to load dashboard' });
    }
  });

  // AI weekly report for the Trends tab. Computes the week's stats
  // deterministically, then asks Vertex to write the analysis. Cached per
  // (user, day) so it generates at most once a day unless ?refresh=1.
  app.get('/api/insights/weekly', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.sessionUser!.userId;
      const refresh = req.query.refresh === '1';
      const periodKey = new Date().toISOString().slice(0, 10);

      if (!refresh) {
        const cached = await env.DB
          .prepare('SELECT report_json FROM weekly_reports WHERE user_id = ? AND period_key = ?')
          .bind(userId, periodKey)
          .first<{ report_json: string }>();
        if (cached) {
          res.json(JSON.parse(cached.report_json));
          return;
        }
      }

      // ── Compute the last-7-day stats ──────────────────────────────────────
      const intake = await env.DB
        .prepare(
          `SELECT entry_date, SUM(calories) AS cal, SUM(protein_g) AS pro
           FROM food_entries WHERE user_id = ? AND entry_date >= date('now', '-6 days')
           GROUP BY entry_date`
        )
        .bind(userId)
        .all<{ entry_date: string; cal: number; pro: number }>();
      const days = (intake.results ?? []).filter((d) => d.cal >= 200);
      const daysLogged = days.length;
      const avg = (xs: number[]) =>
        xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
      const avgCalories = avg(days.map((d) => d.cal));
      const avgProtein = avg(days.map((d) => Math.round(d.pro)));

      const stepRows = await env.DB
        .prepare(
          `SELECT steps FROM daily_activity
           WHERE user_id = ? AND activity_date >= date('now', '-6 days') AND steps IS NOT NULL`
        )
        .bind(userId)
        .all<{ steps: number }>();
      const avgSteps = avg((stepRows.results ?? []).map((r) => r.steps));

      const prefs = await env.DB
        .prepare(
          `SELECT daily_calorie_goal, daily_protein_goal_g, behavior_instructions
           FROM user_tracking_preferences WHERE user_id = ?`
        )
        .bind(userId)
        .first<{
          daily_calorie_goal: number | null;
          daily_protein_goal_g: number | null;
          behavior_instructions: string | null;
        }>();

      const plan = await new GoalPlanRepository(env.DB).getActive(userId);
      const weightGoalDir: WeeklyStats['weight_goal_direction'] = plan
        ? plan.goal_weight_kg < plan.start_weight_kg
          ? 'lose'
          : plan.goal_weight_kg > plan.start_weight_kg
            ? 'gain'
            : 'maintain'
        : null;

      // Weight change across the window (first vs last weigh-in in ~14 days).
      const weigh = await env.DB
        .prepare(
          `SELECT weight_kg, tdee_calories, recorded_date FROM profile_tracking
           WHERE user_id = ? AND weight_kg IS NOT NULL AND recorded_date >= date('now', '-14 days')
           ORDER BY recorded_date ASC`
        )
        .bind(userId)
        .all<{ weight_kg: number; tdee_calories: number | null; recorded_date: string }>();
      const weighIns = weigh.results ?? [];
      const weightChange =
        weighIns.length >= 2
          ? Math.round((weighIns[weighIns.length - 1]!.weight_kg - weighIns[0]!.weight_kg) * 10) / 10
          : null;

      const latestTdee = [...weighIns].reverse().find((w) => w.tdee_calories !== null)?.tdee_calories ?? null;
      const weeklyDeficit =
        latestTdee && avgCalories !== null ? Math.round((latestTdee - avgCalories) * daysLogged) : null;

      const stats: WeeklyStats = {
        days_logged: daysLogged,
        avg_calories: avgCalories,
        calorie_goal: prefs?.daily_calorie_goal ?? null,
        avg_protein_g: avgProtein,
        protein_goal_g: prefs?.daily_protein_goal_g ?? null,
        avg_steps: avgSteps,
        step_goal: plan?.daily_step_goal ?? null,
        weight_change_kg: weightChange,
        weight_goal_direction: weightGoalDir,
        estimated_weekly_deficit_kcal: weeklyDeficit,
        diet_notes: prefs?.behavior_instructions ? prefs.behavior_instructions.slice(0, 400) : null,
      };

      // Too little data to say anything useful.
      if (daysLogged < 2) {
        res.json({
          report: {
            headline: 'Not enough data yet',
            summary: `Log at least a couple of days this week and I'll analyse your calories, protein, steps and weight trend here.`,
            wins: [],
            focus: ['Log your meals for a few days so this report has something to work with.'],
          },
          stats,
          generated_at: new Date().toISOString(),
          source: 'insufficient',
        });
        return;
      }

      const credentialJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
      const project = process.env.GCP_PROJECT;

      // Rule-based fallback used when Vertex is off or fails — the tab still works.
      const fallback = () => {
        const wins: string[] = [];
        const focus: string[] = [];
        if (daysLogged >= 5) wins.push(`Logged ${daysLogged} of the last 7 days — great consistency.`);
        else focus.push(`Only ${daysLogged} days logged — aim for 6–7 for a clearer picture.`);
        if (stats.calorie_goal && avgCalories !== null) {
          if (avgCalories <= stats.calorie_goal) wins.push('Averaged at or under your calorie target.');
          else focus.push(`Averaging ${avgCalories - stats.calorie_goal} kcal/day over target.`);
        }
        if (stats.protein_goal_g && avgProtein !== null && avgProtein >= stats.protein_goal_g * 0.9)
          wins.push('Protein was on point.');
        return {
          report: {
            headline: daysLogged >= 5 ? 'Consistent week' : 'A partial week',
            summary: `You logged ${daysLogged} days, averaging ${avgCalories ?? '—'} kcal${
              stats.calorie_goal ? ` against a ${stats.calorie_goal} goal` : ''
            }${avgProtein !== null ? ` and ${avgProtein}g protein` : ''}${
              avgSteps !== null ? `, with about ${avgSteps.toLocaleString()} steps/day` : ''
            }${weightChange !== null ? `. Weight moved ${weightChange > 0 ? '+' : ''}${weightChange} kg` : ''}.`,
            wins,
            focus,
          },
          stats,
          generated_at: new Date().toISOString(),
          source: 'rule',
        };
      };

      if (!credentialJson || !project) {
        res.json(fallback());
        return;
      }

      let payload: unknown;
      try {
        const report = await generateWeeklyInsights({
          displayName: req.sessionUser!.name,
          stats,
          credentialJson,
          project,
          location: process.env.GCP_LOCATION || 'us-central1',
          model: process.env.LLM_MODEL || 'gemini-2.5-flash',
        });
        payload = { report, stats, generated_at: new Date().toISOString(), source: 'ai' };
        await env.DB
          .prepare(
            'INSERT OR REPLACE INTO weekly_reports (user_id, period_key, report_json) VALUES (?, ?, ?)'
          )
          .bind(userId, periodKey, JSON.stringify(payload))
          .run();
      } catch (error) {
        console.error('Weekly insights AI error:', error);
        payload = fallback();
      }

      res.json(payload);
    } catch (error) {
      console.error('Weekly insights error:', error);
      res.status(500).json({ error: 'Failed to build your weekly report.' });
    }
  });

  // Admin-only overview: adoption + AI cost. Gated on the admin role.
  app.get('/api/admin/overview', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.sessionUser!.isAdmin) {
        res.status(403).json({ error: 'Admins only.' });
        return;
      }

      const users = await env.DB
        .prepare('SELECT id, email, name, role, created_at FROM users ORDER BY created_at DESC')
        .all<{ id: string; email: string; name: string; role: string; created_at: string }>();
      const logs = await env.DB
        .prepare(
          `SELECT user_id, COUNT(*) n, MAX(entry_date) last, COUNT(DISTINCT entry_date) days
           FROM food_entries GROUP BY user_id`
        )
        .all<{ user_id: string; n: number; last: string; days: number }>();
      const byUser = new Map((logs.results ?? []).map((l) => [l.user_id, l]));
      const cutoff7 = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

      const userRows = (users.results ?? []).map((u) => {
        const l = byUser.get(u.id);
        return {
          name: u.name,
          email: u.email,
          role: u.role,
          signed_up: (u.created_at ?? '').slice(0, 10),
          entries: l?.n ?? 0,
          days_logged: l?.days ?? 0,
          last_log: l?.last ?? null,
          active_7d: !!l?.last && l.last >= cutoff7,
        };
      });

      const totalEntriesRow = await env.DB.prepare('SELECT COUNT(*) c FROM food_entries').first<{ c: number }>();
      const entries7dRow = await env.DB
        .prepare("SELECT COUNT(*) c FROM food_entries WHERE entry_date >= date('now','-7 days')")
        .first<{ c: number }>();
      const foodsRow = await env.DB.prepare('SELECT COUNT(*) c FROM foods').first<{ c: number }>();
      const weighRow = await env.DB
        .prepare('SELECT COUNT(*) c FROM profile_tracking WHERE weight_kg IS NOT NULL')
        .first<{ c: number }>();

      const credentialJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
      const project = process.env.GCP_PROJECT;
      const ai = credentialJson && project ? await getVertexUsage(credentialJson, project) : null;

      res.json({
        users: {
          total: userRows.length,
          logged_food: userRows.filter((u) => u.entries > 0).length,
          active_7d: userRows.filter((u) => u.active_7d).length,
          list: userRows,
        },
        content: {
          total_entries: totalEntriesRow?.c ?? 0,
          entries_7d: entries7dRow?.c ?? 0,
          foods: foodsRow?.c ?? 0,
          weigh_ins: weighRow?.c ?? 0,
        },
        ai,
        railway_estimate_usd: 5,
        generated_at: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Admin overview error:', error);
      res.status(500).json({ error: 'Failed to load admin overview.' });
    }
  });

  // Compact stats bundle for the shareable "daily story" card.
  app.get('/api/share/today', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.sessionUser!.userId;
      const date =
        typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
          ? req.query.date
          : new Date().toISOString().slice(0, 10);

      const totals = await env.DB
        .prepare(
          `SELECT COALESCE(SUM(calories),0) cal, COALESCE(SUM(protein_g),0) pro,
                  COALESCE(SUM(carbs_g),0) carb, COALESCE(SUM(fat_g),0) fat
           FROM food_entries WHERE user_id = ? AND entry_date = ?`
        )
        .bind(userId, date)
        .first<{ cal: number; pro: number; carb: number; fat: number }>();

      const prefs = await env.DB
        .prepare(
          `SELECT daily_calorie_goal, daily_protein_goal_g FROM user_tracking_preferences WHERE user_id = ?`
        )
        .bind(userId)
        .first<{ daily_calorie_goal: number | null; daily_protein_goal_g: number | null }>();

      // Steps for the day, else the most recent day with steps.
      const stepRow = await env.DB
        .prepare(
          `SELECT steps FROM daily_activity WHERE user_id = ? AND steps IS NOT NULL
             AND activity_date <= ? ORDER BY activity_date DESC LIMIT 1`
        )
        .bind(userId, date)
        .first<{ steps: number }>();

      // Logging streak ending on `date` (or the day before).
      const dateRows = await env.DB
        .prepare(
          `SELECT DISTINCT entry_date FROM food_entries WHERE user_id = ? AND entry_date <= ?
           ORDER BY entry_date DESC LIMIT 120`
        )
        .bind(userId, date)
        .all<{ entry_date: string }>();
      const logged = new Set((dateRows.results ?? []).map((r) => r.entry_date));
      const shift = (d: string, n: number) => {
        const dt = new Date(`${d}T00:00:00Z`);
        dt.setUTCDate(dt.getUTCDate() + n);
        return dt.toISOString().slice(0, 10);
      };
      let streak = 0;
      let cursor = logged.has(date) ? date : logged.has(shift(date, -1)) ? shift(date, -1) : null;
      while (cursor && logged.has(cursor)) {
        streak += 1;
        cursor = shift(cursor, -1);
      }

      // Weight: latest + change over ~2 weeks.
      const weigh = await env.DB
        .prepare(
          `SELECT weight_kg, recorded_date FROM profile_tracking
           WHERE user_id = ? AND weight_kg IS NOT NULL AND recorded_date <= ?
           ORDER BY recorded_date DESC LIMIT 30`
        )
        .bind(userId, date)
        .all<{ weight_kg: number; recorded_date: string }>();
      const weighIns = weigh.results ?? [];
      const latestWeight = weighIns[0]?.weight_kg ?? null;
      const twoWeeksAgo = shift(date, -14);
      const past = weighIns.find((w) => w.recorded_date <= twoWeeksAgo) ?? weighIns[weighIns.length - 1];
      const weightChange =
        latestWeight !== null && past && past.recorded_date !== weighIns[0]?.recorded_date
          ? Math.round((latestWeight - past.weight_kg) * 10) / 10
          : null;

      res.json({
        date,
        name: req.sessionUser!.name,
        calories: { consumed: Math.round(totals?.cal ?? 0), goal: prefs?.daily_calorie_goal ?? null },
        protein: { consumed: Math.round(totals?.pro ?? 0), goal: prefs?.daily_protein_goal_g ?? null },
        carbs_g: Math.round(totals?.carb ?? 0),
        fat_g: Math.round(totals?.fat ?? 0),
        steps: stepRow?.steps ?? null,
        streak,
        weight_kg: latestWeight,
        weight_change_kg: weightChange,
      });
    } catch (error) {
      console.error('Share stats error:', error);
      res.status(500).json({ error: 'Failed to build share stats.' });
    }
  });

  app.post('/api/tokens/rotate', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const existingToken = await env.DB
        .prepare('SELECT api_key_hash FROM users WHERE id = ?')
        .bind(req.sessionUser!.userId)
        .first<{ api_key_hash: string | null }>();

      if (existingToken?.api_key_hash) {
        res.status(409).json({
          error: 'API token already exists and cannot be replaced.',
        });
        return;
      }

      const token = randomToken(24);

      await env.DB
        .prepare('UPDATE users SET api_key_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(hashSha256(token), req.sessionUser!.userId)
        .run();

      res.json({
        token,
        message: 'API token generated. Store it securely; it cannot be replaced later.',
      });
    } catch (error) {
      console.error('Token rotate error:', error);
      res.status(500).json({ error: 'Failed to rotate API token' });
    }
  });

  app.get('/api/tokens/status', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const user = await env.DB
        .prepare('SELECT api_key_hash FROM users WHERE id = ?')
        .bind(req.sessionUser!.userId)
        .first<{ api_key_hash: string | null }>();

      res.json({
        has_token: Boolean(user?.api_key_hash),
      });
    } catch (error) {
      console.error('Token status error:', error);
      res.status(500).json({ error: 'Failed to load token status' });
    }
  });

  app.post('/api/tokens/revoke', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const result = await env.DB
        .prepare('UPDATE users SET api_key_hash = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(req.sessionUser!.userId)
        .run();

      if (result.meta.changes === 0) {
        res.status(404).json({ error: 'Token not found.' });
        return;
      }

      res.json({
        ok: true,
        message: 'API token revoked. You can now generate a new one.',
      });
    } catch (error) {
      console.error('Token revoke error:', error);
      res.status(500).json({ error: 'Failed to revoke API token' });
    }
  });

  app.get('/api/admin/bootstrap-info', requireSession, async (req: AuthenticatedRequest, res) => {
    if (!req.sessionUser?.isAdmin) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    res.json({
      admin_api_key_configured: Boolean(options.env.ADMIN_API_KEY),
      oauth_registration_endpoint: '/oauth/register',
      headers_required: ['X-API-Key'],
    });
  });
}
