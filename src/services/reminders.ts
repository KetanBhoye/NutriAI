import type { AppEnv } from '../db/types.js';
import { isPushConfigured, sendPushToUser, subscribedUserIds, type PushPayload } from './push.js';

/**
 * A once-a-day evening nudge to subscribed users, built from where they are
 * against today's targets (nothing logged → "log your meals"; short on
 * protein/calories → "time for dinner"; on target → a quick well-done).
 *
 * Runs in-process (single Railway instance), checking the clock every few
 * minutes. Config via env:
 *   REMINDER_ENABLED        "false" turns it off (default on)
 *   REMINDER_HOUR_UTC       hour to fire, UTC (default 14 → 19:30 IST)
 *   REMINDER_MINUTE_UTC     minute (default 30)
 *
 * It fires within a 3-hour window after the target so a server that restarts
 * in the evening still sends, but a 3am restart never replays yesterday's.
 */
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const WINDOW_MINUTES = 180;

let lastSentDate: string | null = null;

function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function minutesOfDayUTC(now: Date): number {
  return now.getUTCHours() * 60 + now.getUTCMinutes();
}

export function startDailyReminders(env: AppEnv): void {
  if (process.env.REMINDER_ENABLED === 'false') {
    console.log('[reminders] disabled via REMINDER_ENABLED=false');
    return;
  }
  if (!isPushConfigured()) {
    console.log('[reminders] push not configured — reminders off');
    return;
  }

  const hour = Number(process.env.REMINDER_HOUR_UTC ?? 14);
  const minute = Number(process.env.REMINDER_MINUTE_UTC ?? 30);
  const targetMinutes = hour * 60 + minute;
  console.log(`[reminders] scheduled for ${hour}:${String(minute).padStart(2, '0')} UTC daily`);

  const tick = async () => {
    try {
      const now = new Date();
      const today = utcDate(now);
      const mins = minutesOfDayUTC(now);
      if (lastSentDate === today) return;
      if (mins < targetMinutes || mins > targetMinutes + WINDOW_MINUTES) return;

      lastSentDate = today; // set before sending so a slow send can't double-fire
      const count = await sendDailyReminders(env, today);
      console.log(`[reminders] sent ${count} reminder(s) for ${today}`);
    } catch (error) {
      console.error('[reminders] tick failed:', error);
    }
  };

  // A short initial delay lets the app finish booting, then check on a cadence.
  setTimeout(tick, 15_000);
  setInterval(tick, CHECK_INTERVAL_MS);
}

/** Sends today's reminder to everyone subscribed. Returns how many delivered. */
export async function sendDailyReminders(env: AppEnv, today: string): Promise<number> {
  const userIds = await subscribedUserIds(env.DB);
  let delivered = 0;
  for (const userId of userIds) {
    const payload = await reminderFor(env, userId, today);
    if (payload) delivered += await sendPushToUser(env.DB, userId, payload);
  }
  return delivered;
}

/**
 * Sends the reminder a user would get right now — used by the "send a sample"
 * button so they can preview the real, personalised content on demand.
 */
export async function sendReminderNow(env: AppEnv, userId: string): Promise<number> {
  const payload = await reminderFor(env, userId, utcDate(new Date()));
  if (!payload) return 0;
  return sendPushToUser(env.DB, userId, payload);
}

/** Builds a personalised reminder for one user, or null to skip them. */
async function reminderFor(env: AppEnv, userId: string, today: string): Promise<PushPayload | null> {
  const prefs = await env.DB
    .prepare(
      `SELECT daily_calorie_goal, daily_protein_goal_g
       FROM user_tracking_preferences WHERE user_id = ?`
    )
    .bind(userId)
    .first<{ daily_calorie_goal: number | null; daily_protein_goal_g: number | null }>();

  const totals = await env.DB
    .prepare(
      `SELECT COALESCE(SUM(calories), 0) AS cal, COALESCE(SUM(protein_g), 0) AS pro
       FROM food_entries WHERE user_id = ? AND entry_date = ?`
    )
    .bind(userId, today)
    .first<{ cal: number; pro: number }>();

  const cal = totals?.cal ?? 0;
  const pro = totals?.pro ?? 0;
  const url = '/app/';

  // Logged nothing today — the most useful nudge.
  if (cal <= 0) {
    return {
      title: 'Log your meals 🍽️',
      body: "You haven't logged anything today. Tap to add what you ate.",
      url,
      tag: 'nutriai-daily',
    };
  }

  const calGoal = prefs?.daily_calorie_goal ?? null;
  const proGoal = prefs?.daily_protein_goal_g ?? null;
  const calLeft = calGoal ? Math.round(calGoal - cal) : null;
  const proLeft = proGoal ? Math.round(proGoal - pro) : null;

  const bits: string[] = [];
  if (proLeft !== null && proLeft > 15) bits.push(`${proLeft}g protein`);
  if (calLeft !== null && calLeft > 200) bits.push(`${calLeft} kcal`);

  if (bits.length > 0) {
    return {
      title: 'Dinner time? 🍛',
      body: `You've got ${bits.join(' and ')} left today. A good moment to round out your day.`,
      url,
      tag: 'nutriai-daily',
    };
  }

  // On or over target — a light, occasional well-done rather than nagging.
  return {
    title: 'Nice work today 💪',
    body: "You've hit your targets. Log dinner if you haven't, and you're set.",
    url,
    tag: 'nutriai-daily',
  };
}
