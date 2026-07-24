import { randomUUID } from 'node:crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import z from 'zod';
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
import { lookupFood } from '../services/food-lookup.js';
import { linkEntryToFood } from '../services/entry-linking.js';
import { createProviderFromEnv, parseFoodLog } from '../services/llm/index.js';
import { runCoachTurn } from '../services/coach/agent.js';
import { UserTrackingPreferencesRepository } from '../repositories/user-tracking-preferences.repository.js';
import { GoalPlanRepository } from '../repositories/goal-plan.repository.js';
import { DailyActivityRepository as ActivityRepo } from '../repositories/daily-activity.repository.js';
import { buildDeficitSeries, buildGlidePath, weeklyDeficit } from '../services/goal-progress.js';
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
    protein_g: z.number().min(0).optional(),
    carbs_g: z.number().min(0).optional(),
    fat_g: z.number().min(0).optional(),
    meal_type: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).optional(),
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
        res.status(400).json({ error: parsed.error.message });
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
        res.status(400).json({ error: parsed.error.message });
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
        res.status(400).json({ error: parsed.error.message });
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
        res.status(400).json({ error: parsed.error.message });
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
        res.status(400).json({ error: parsed.error.message });
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
      const deficitDays = buildDeficitSeries(intakeByDate, tdeeByDate, latestTdee);

      const activityRepo = new ActivityRepo(env.DB);
      const activity = await activityRepo.listRecent(userId, 60);

      res.json({
        plan,
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
        res.status(400).json({ error: parsed.error.message });
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
        res.status(400).json({ error: parsed.error.message });
        return;
      }

      await new UserTrackingPreferencesRepository(env.DB).upsert(req.sessionUser!.userId, parsed.data);
      res.json({ ok: true });
    } catch (error) {
      console.error('Preferences save error:', error);
      res.status(500).json({ error: 'Failed to save preferences' });
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
        res.status(400).json({ error: parsed.error.message });
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

  app.post('/api/coach/chat', requireSession, async (req: AuthenticatedRequest, res) => {
    try {
      const parsed = coachChatSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.message });
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

      const result = await runCoachTurn({
        message: parsed.data.message,
        history: (parsed.data.history ?? []) as never,
        userId,
        env,
        knownFoods,
        credentialJson,
        project,
        location: process.env.GCP_LOCATION || 'us-central1',
        model: process.env.LLM_MODEL || 'gemini-2.5-flash',
      });

      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('429')) {
        // Vertex rate limit — transient, the user just retries.
        res.status(429).json({ error: "The AI is busy right now — give it a few seconds and try again." });
        return;
      }
      console.error('Coach chat error:', error);
      res.status(502).json({ error: 'The Coach could not be reached. Try again in a moment.' });
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
        res.status(400).json({ error: parsed.error.message });
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
        res.status(400).json({ error: parsed.error.message });
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
