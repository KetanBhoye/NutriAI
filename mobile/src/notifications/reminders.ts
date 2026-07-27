import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { entriesApi, goalsApi } from '@/api';
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
 * The trade-off is that the OS schedules the text ahead of time, so it can't
 * reflect what you've eaten *since* it was scheduled. We re-schedule whenever
 * the app is opened, so the copy is accurate as of your last visit.
 */

const ENABLED_KEY = 'nutriai.reminders.enabled';
const IDENTIFIER = 'nutriai.daily-log-reminder';
const HOUR = 20; // 8pm — late enough to have eaten, early enough to still log.

export async function remindersEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(ENABLED_KEY)) === '1';
}

/** Builds copy from the day's totals so the nudge is specific, not generic. */
async function buildBody(): Promise<string> {
  try {
    const [entries, goals] = await Promise.all([
      entriesApi.getEntries(todayISO()),
      goalsApi.getGoals(),
    ]);
    const eaten = entries.entries.reduce((sum, e) => sum + e.calories, 0);
    const goal = goals.macros.calories;

    if (entries.entries.length === 0) return "You haven't logged anything today. Takes 20 seconds.";
    if (goal && eaten < goal) {
      return `${Math.round(goal - eaten)} kcal left today. Anything else to add?`;
    }
    return `${Math.round(eaten)} kcal logged today. Round the day off?`;
  } catch {
    return 'Anything left to log today?';
  }
}

/**
 * Schedules (or re-schedules) the daily reminder. Safe to call on every
 * launch — it clears the previous one first so reminders can't stack up.
 */
export async function scheduleDailyReminder(): Promise<void> {
  if (!(await remindersEnabled())) return;

  await Notifications.cancelScheduledNotificationAsync(IDENTIFIER).catch(() => {});
  await Notifications.scheduleNotificationAsync({
    identifier: IDENTIFIER,
    content: { title: 'NutriAI', body: await buildBody() },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: HOUR,
      minute: 0,
    },
  });
}

/** Returns whether reminders ended up on — permission may be refused. */
export async function setRemindersEnabled(enabled: boolean): Promise<boolean> {
  if (!enabled) {
    await AsyncStorage.setItem(ENABLED_KEY, '0');
    await Notifications.cancelScheduledNotificationAsync(IDENTIFIER).catch(() => {});
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
    content: { title: 'NutriAI', body: await buildBody() },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 3 },
  });
}
