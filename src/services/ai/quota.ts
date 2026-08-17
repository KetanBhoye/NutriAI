import type { D1DatabaseCompat } from '../../db/types.js';
import { sqlTimestampNow } from '../../db/time.js';
import { projectUsageSince, usageSince, type AiFeature } from './metering.js';
import { getNumberSetting, getSetting, SETTINGS } from '../settings.js';

/**
 * Who is allowed how much AI, and what happens when they run out.
 *
 * Three rules this encodes, each of which came from a specific failure mode:
 *
 *  1. **Two windows, not one.** A monthly allowance alone can be burned in an
 *     hour by a script; a daily cap alone puts no bound on the month. Both are
 *     checked, and the tighter one wins.
 *
 *  2. **Degrade, never refuse.** Over quota returns `allowed: false` and the
 *     caller falls back to the rule-based path that already exists for when
 *     Vertex is down. A tracker that stops working at 4pm is a tracker people
 *     delete; one that says "estimated, not looked up" is merely honest.
 *
 *  3. **A project ceiling above the per-user ones.** Per-user limits assume the
 *     failure is one user. They do nothing about a bug that calls the model in
 *     a loop, or a hundred fresh accounts. The global cap is the only control
 *     that bounds the actual bill, and it is the cheapest thing here to build.
 */

export type Plan = 'free' | 'pro';

/**
 * The plan a new account starts on.
 *
 * Everyone is on pro while the app is in early access — nothing is gated, the
 * quota ceilings are still placeholders, and the people using it were invited
 * personally. Set explicitly at signup rather than left to the column default,
 * because SQLite cannot alter a default in place: relying on it would have
 * meant Postgres and SQLite disagreeing about what a new user gets, which is
 * the exact class of divergence the driver-parity work exists to prevent.
 */
export const DEFAULT_PLAN: Plan = 'pro';

interface Limits {
  /** Calls of this feature per rolling 24h. */
  perDay: number;
  /** Calls of this feature per rolling 30 days. */
  perMonth: number;
}

/**
 * Starting numbers, not final ones.
 *
 * These are placeholders sized from list prices, and they should be replaced
 * once `ai_usage` has a fortnight of real distribution behind it — the point of
 * metering first. They are deliberately generous: a limit that bites a normal
 * user is a worse outcome than a slightly larger bill while we learn.
 */
const LIMITS: Record<Plan, Record<AiFeature, Limits>> = {
  free: {
    parse: { perDay: 20, perMonth: 300 },
    photo: { perDay: 3, perMonth: 40 },
    coach: { perDay: 10, perMonth: 150 },
    suggest: { perDay: 5, perMonth: 60 },
    weekly: { perDay: 2, perMonth: 8 },
    onboarding: { perDay: 3, perMonth: 5 },
    // The expensive one. Free users read the shared repo instead — which, once
    // it is warm, answers most common foods without a paid call anyway.
    grounded: { perDay: 0, perMonth: 0 },
  },
  pro: {
    parse: { perDay: 200, perMonth: 3000 },
    photo: { perDay: 30, perMonth: 500 },
    coach: { perDay: 200, perMonth: 3000 },
    suggest: { perDay: 50, perMonth: 600 },
    weekly: { perDay: 10, perMonth: 60 },
    onboarding: { perDay: 5, perMonth: 20 },
    grounded: { perDay: 40, perMonth: 400 },
  },
};

/**
 * Default project-wide spend ceiling for a rolling day, in USD.
 *
 * The live value comes from `app_settings` so the admin dashboard can move it
 * mid-incident; this is only the fallback for a fresh database. Set low enough
 * that hitting it is a signal rather than a catastrophe.
 */
const DAILY_PROJECT_CEILING_USD = Number(process.env.AI_DAILY_BUDGET_USD ?? '25');

function hoursAgo(hours: number, now = new Date()): string {
  return sqlTimestampNow(new Date(now.getTime() - hours * 3600_000));
}

export interface QuotaDecision {
  allowed: boolean;
  /** Present when refused; safe to show a user. */
  reason?: 'daily' | 'monthly' | 'plan' | 'project_budget' | 'disabled';
  /** A sentence the client can display verbatim. */
  message?: string;
}

const ALLOW: QuotaDecision = { allowed: true };

export async function checkQuota(
  db: D1DatabaseCompat,
  userId: string,
  plan: Plan,
  feature: AiFeature,
  now = new Date()
): Promise<QuotaDecision> {
  // The kill switch is first because it is the control you reach for while
  // something is actively going wrong; nothing below it should be able to keep
  // spending once it is off.
  const enabled = await getSetting(db, SETTINGS.AI_ENABLED, 'on');
  if (enabled === 'off') {
    return {
      allowed: false,
      reason: 'disabled',
      message: 'AI features are paused right now. Your logging still works normally.',
    };
  }

  // The project ceiling is checked next and for everybody: it exists to bound
  // the bill, and a Pro user is not a reason to keep spending past it.
  const ceiling = await getNumberSetting(
    db,
    SETTINGS.AI_DAILY_BUDGET_USD,
    DAILY_PROJECT_CEILING_USD
  );
  const project = await projectUsageSince(db, hoursAgo(24, now));
  if (project.costUsd >= ceiling) {
    return {
      allowed: false,
      reason: 'project_budget',
      message: 'AI features are briefly unavailable. Your logging still works normally.',
    };
  }

  const limits = LIMITS[plan][feature];

  // A zero limit means the plan does not include the feature at all, which is a
  // different message from "you have used yours up today".
  if (limits.perDay === 0 && limits.perMonth === 0) {
    return {
      allowed: false,
      reason: 'plan',
      message: 'Verified nutrition lookups are a Pro feature.',
    };
  }

  const day = await usageSince(db, userId, hoursAgo(24, now), feature);
  if (day.calls >= limits.perDay) {
    return {
      allowed: false,
      reason: 'daily',
      message: "You've used today's allowance for this. It resets in a few hours.",
    };
  }

  const month = await usageSince(db, userId, hoursAgo(24 * 30, now), feature);
  if (month.calls >= limits.perMonth) {
    return {
      allowed: false,
      reason: 'monthly',
      message: "You've used this month's allowance for this feature.",
    };
  }

  return ALLOW;
}

/** The plan on the user row; anything unrecognised is treated as free. */
export async function planFor(db: D1DatabaseCompat, userId: string): Promise<Plan> {
  try {
    const row = await db
      .prepare('SELECT plan FROM users WHERE id = ?')
      .bind(userId)
      .first<{ plan: string | null }>();
    return row?.plan === 'pro' ? 'pro' : 'free';
  } catch {
    // Before the migration lands, or if the column is missing: fail closed to
    // free rather than handing out Pro limits by accident.
    return 'free';
  }
}

/** Exposed for the admin page and for tests. */
export function limitsFor(plan: Plan, feature: AiFeature): Limits {
  return LIMITS[plan][feature];
}

export { DAILY_PROJECT_CEILING_USD };
