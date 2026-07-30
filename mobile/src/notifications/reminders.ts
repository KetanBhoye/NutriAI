import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { entriesApi, goalsApi } from '@/api';
import { cached } from '@/cache';
import { todayISO } from '@/dates';

/**
 * Daily "log your meals" reminder, delivered as a **local** notification.
 *
 * Deliberately not remote push: APNs requires an Auth Key that only exists
 * behind a paid Apple Developer membership, and the `aps-environment`
 * entitlement needs a provisioning profile with the Push capability, which a
 * personal team cannot create. Local notifications need neither, cost nothing,
 * and cover the actual use case — a nudge at a fixed time each day.
 *
 * The OS fixes the text when the notification is scheduled, so a repeating
 * daily trigger would keep re-delivering one day's numbers forever — that's
 * how the reminder ended up quoting calories the app disagreed with. Instead
 * we schedule a week of one-shot reminders and re-arm them whenever the app is
 * opened or backgrounded: only today's can carry live numbers, so only today's
 * does. The rest quote the goal, which is true on any day.
 */

const ENABLED_KEY = 'nutriai.reminders.enabled';
const IDENTIFIER = 'nutriai.daily-log-reminder';
const HOUR = 20; // 8pm — late enough to have eaten, early enough to still log.
/** How far ahead to schedule, so missing a few days doesn't end the reminders. */
const DAYS_AHEAD = 14;

const idFor = (dayOffset: number) => `${IDENTIFIER}.${dayOffset}`;

export async function remindersEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(ENABLED_KEY)) === '1';
}

/** The calorie target, read the same way the app's screens read it. */
async function calorieGoal(): Promise<number | null> {
  try {
    const { data } = await cached('goals', () => goalsApi.getGoals());
    return data.macros.calories ?? null;
  } catch {
    return null;
  }
}

/** Copy for today, built from the day's totals so the nudge is specific. */
async function todayBody(goal: number | null): Promise<string> {
  try {
    const entries = await entriesApi.getEntries(todayISO());
    const eaten = entries.entries.reduce((sum, e) => sum + e.calories, 0);

    if (entries.entries.length === 0) return "You haven't logged anything today. Takes 20 seconds.";
    if (goal && eaten < goal) {
      return `${Math.round(goal - eaten)} kcal left today. Anything else to add?`;
    }
    return `${Math.round(eaten)} kcal logged today. Round the day off?`;
  } catch {
    return laterBody(goal);
  }
}

/**
 * Copy for a future day. It can only mention things that will still be true
 * then, so it quotes the target rather than a total logged days earlier.
 */
function laterBody(goal: number | null): string {
  return goal
    ? `Your target is ${goal.toLocaleString()} kcal. Anything left to log today?`
    : 'Anything left to log today?';
}

/** 8pm on the day `offset` days from now, in the device's own timezone. */
function fireAt(offset: number): Date {
  const at = new Date();
  at.setDate(at.getDate() + offset);
  at.setHours(HOUR, 0, 0, 0);
  return at;
}

async function cancelAll(): Promise<void> {
  await Promise.all(
    // The old build used a single repeating notification under the bare
    // identifier; clear that too so upgrades don't keep a stale one alive.
    [IDENTIFIER, ...Array.from({ length: DAYS_AHEAD }, (_, i) => idFor(i))].map((id) =>
      Notifications.cancelScheduledNotificationAsync(id).catch(() => {})
    )
  );
}

/**
 * Schedules (or re-schedules) the reminders. Safe to call on every launch,
 * backgrounding and plan change — it clears the previous set first, so they
 * can't stack up, and rebuilds the copy from current numbers.
 */
export async function scheduleDailyReminder(): Promise<void> {
  await cancelAll();
  if (!(await remindersEnabled())) return;

  const goal = await calorieGoal();
  const now = Date.now();

  for (let offset = 0; offset < DAYS_AHEAD; offset += 1) {
    const date = fireAt(offset);
    if (date.getTime() <= now) continue; // today's 8pm has already passed
    await Notifications.scheduleNotificationAsync({
      identifier: idFor(offset),
      content: {
        title: 'NutriAI',
        body: offset === 0 ? await todayBody(goal) : laterBody(goal),
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
    });
  }
}

/** Returns whether reminders ended up on — permission may be refused. */
export async function setRemindersEnabled(enabled: boolean): Promise<boolean> {
  if (!enabled) {
    await AsyncStorage.setItem(ENABLED_KEY, '0');
    await cancelAll();
    return false;
  }

  const existing = await Notifications.getPermissionsAsync();
  const granted =
    existing.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return false;

  await AsyncStorage.setItem(ENABLED_KEY, '1');
  await scheduleDailyReminder();
  return true;
}

/** Fires a notification a few seconds out, so the user can see what they get. */
export async function sendPreviewReminder(): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: { title: 'NutriAI', body: await todayBody(await calorieGoal()) },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 3 },
  });
}
