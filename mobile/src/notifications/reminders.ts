import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { entriesApi, goalsApi } from '@/api';
import { cached } from '@/cache';
import { todayISO } from '@/dates';
import { MealType } from '@/types';
import { MEAL_SLOTS, reminderCopy } from './copy';

/**
 * Meal reminders, delivered as **local** notifications.
 *
 * Deliberately not remote push: APNs requires an Auth Key that only exists
 * behind a paid Apple Developer membership, and the `aps-environment`
 * entitlement needs a provisioning profile with the Push capability, which a
 * personal team cannot create. Local notifications need neither, cost nothing,
 * and cover the actual use case — a nudge at fixed times each day.
 *
 * The OS fixes the text when the notification is scheduled, so a repeating
 * daily trigger would keep re-delivering one day's numbers forever. Instead we
 * schedule a week of one-shot reminders and re-arm them whenever the app is
 * opened or backgrounded: only today's can carry live numbers, so only today's
 * does. See copy.ts.
 *
 * ## Why reminders used to arrive only sometimes
 *
 * The previous version cancelled every pending notification and *then* made two
 * network calls to rebuild the copy before rescheduling. It ran on every
 * backgrounding — precisely when the OS is about to suspend the process. Lose
 * that race and the user has no reminders at all until they next open the app.
 *
 * So: nothing is cancelled before the replacement is ready. Identifiers are
 * stable per (day, meal) and `scheduleNotificationAsync` overwrites an existing
 * notification with the same identifier, so re-arming is idempotent and never
 * leaves a gap. Only genuinely stale identifiers are cancelled, at the end.
 */

const ENABLED_KEY = 'nutriai.reminders.enabled';
const PREFIX = 'nutriai.meal-reminder';
/** The pre-meal-slots identifier, cancelled on upgrade so it can't linger. */
const LEGACY_IDS = ['nutriai.daily-log-reminder', ...Array.from({ length: 14 }, (_, i) => `nutriai.daily-log-reminder.${i}`)];

/**
 * Seven days × four meals = 28 pending notifications.
 *
 * iOS silently drops anything past 64 pending, so the horizon and the slot
 * count are linked: a fortnight would sit at 56 and leave no room for anything
 * else the app might ever schedule.
 */
const DAYS_AHEAD = 7;

const idFor = (dayOffset: number, meal: MealType) => `${PREFIX}.${dayOffset}.${meal}`;

/**
 * Reminders are ON unless the user has turned them off.
 *
 * A reminder app whose reminders are off by default is a habit tracker nobody
 * builds a habit with. The stored value is only ever written by an explicit
 * choice, so an opt-out is sticky and is never silently undone by an update.
 */
export async function remindersEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(ENABLED_KEY)) !== '0';
}

/** Whether the user has ever made a choice, as opposed to inheriting the default. */
export async function remindersChosen(): Promise<boolean> {
  return (await AsyncStorage.getItem(ENABLED_KEY)) != null;
}

interface DayState {
  loggedMeals: MealType[];
  remainingKcal: number | null;
  remainingProteinG: number | null;
}

/**
 * Today's totals, for copy that can name a real number.
 *
 * Failure is not fatal — an unreachable API means generic copy, not an absent
 * reminder. Losing the nudge entirely is far worse than losing the number in it.
 */
async function readToday(): Promise<DayState> {
  const empty: DayState = { loggedMeals: [], remainingKcal: null, remainingProteinG: null };
  try {
    const [{ data: goals }, entries] = await Promise.all([
      cached('goals', () => goalsApi.getGoals()),
      entriesApi.getEntries(todayISO()),
    ]);

    const eaten = entries.entries.reduce((sum, e) => sum + e.calories, 0);
    const protein = entries.entries.reduce((sum, e) => sum + (e.protein_g ?? 0), 0);
    const kcalGoal = goals.macros.calories ?? null;
    const proteinGoal = goals.macros.protein_g ?? null;

    return {
      loggedMeals: [...new Set(entries.entries.map((e) => e.meal_type as MealType))],
      remainingKcal: kcalGoal != null ? kcalGoal - eaten : null,
      remainingProteinG: proteinGoal != null ? proteinGoal - protein : null,
    };
  } catch {
    return empty;
  }
}

/** The slot's firing time on the day `offset` days out, in the device's timezone. */
function fireAt(offset: number, hour: number, minute: number): Date {
  const at = new Date();
  at.setDate(at.getDate() + offset);
  at.setHours(hour, minute, 0, 0);
  return at;
}

/**
 * Schedules (or re-schedules) every meal reminder. Safe to call on launch,
 * backgrounding and plan change.
 */
export async function scheduleMealReminders(): Promise<void> {
  if (!(await remindersEnabled())) {
    await cancelAll();
    return;
  }

  // Read BEFORE touching anything scheduled: if this fails or the process is
  // suspended here, the existing reminders are still armed.
  const today = await readToday();
  const now = Date.now();
  const seed = todayISO();

  /** Identifiers we deliberately don't want, so stale ones can be cleared. */
  const wanted = new Set<string>();

  for (let offset = 0; offset < DAYS_AHEAD; offset += 1) {
    for (const slot of MEAL_SLOTS) {
      const date = fireAt(offset, slot.hour, slot.minute);
      if (date.getTime() <= now) continue; // already passed today

      const copy = reminderCopy({
        meal: slot.meal,
        isToday: offset === 0,
        loggedMeals: today.loggedMeals,
        remainingKcal: today.remainingKcal,
        remainingProteinG: today.remainingProteinG,
        seed: `${seed}:${offset}`,
      });
      if (!copy) continue; // already logged — say nothing

      const identifier = idFor(offset, slot.meal);
      wanted.add(identifier);
      // Same identifier replaces in place, so there is never a moment with
      // nothing scheduled.
      await Notifications.scheduleNotificationAsync({
        identifier,
        content: { title: copy.title, body: copy.body },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
      });
    }
  }

  // Now, and only now, drop what's no longer wanted: meals that have since been
  // logged, slots that have passed, and the pre-meal-slots identifiers.
  const stale: string[] = [...LEGACY_IDS];
  for (let offset = 0; offset < DAYS_AHEAD; offset += 1) {
    for (const slot of MEAL_SLOTS) {
      const id = idFor(offset, slot.meal);
      if (!wanted.has(id)) stale.push(id);
    }
  }
  await Promise.all(
    stale.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {}))
  );
}

/** Kept as the old name so existing call sites don't need to change. */
export const scheduleDailyReminder = scheduleMealReminders;

async function cancelAll(): Promise<void> {
  const ids = [...LEGACY_IDS];
  for (let offset = 0; offset < DAYS_AHEAD; offset += 1) {
    for (const slot of MEAL_SLOTS) ids.push(idFor(offset, slot.meal));
  }
  await Promise.all(
    ids.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {}))
  );
}

/**
 * Arms reminders on first run, since they default to on.
 *
 * Only asks for permission when the user has never chosen — re-prompting
 * someone who turned them off would be obnoxious, and on Android the OS stops
 * showing the dialog after refusals anyway.
 */
export async function initialiseReminders(): Promise<void> {
  if (!(await remindersEnabled())) return;

  const existing = await Notifications.getPermissionsAsync();
  if (!existing.granted) {
    if (await remindersChosen()) return; // they said yes once; the OS said no
    const asked = await Notifications.requestPermissionsAsync();
    if (!asked.granted) return;
  }

  await scheduleMealReminders();
}

/** Returns whether reminders ended up on — permission may be refused. */
export async function setRemindersEnabled(enabled: boolean): Promise<boolean> {
  if (!enabled) {
    await AsyncStorage.setItem(ENABLED_KEY, '0');
    await cancelAll();
    return false;
  }

  const existing = await Notifications.getPermissionsAsync();
  const granted = existing.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return false;

  await AsyncStorage.setItem(ENABLED_KEY, '1');
  await scheduleMealReminders();
  return true;
}

/** Fires a notification a few seconds out, so the user can see what they get. */
export async function sendPreviewReminder(): Promise<void> {
  const today = await readToday();
  const copy =
    reminderCopy({
      meal: 'dinner',
      isToday: true,
      loggedMeals: [],
      remainingKcal: today.remainingKcal,
      remainingProteinG: today.remainingProteinG,
      seed: todayISO(),
    }) ?? { title: 'NutriAI', body: 'Anything left to log today?' };

  await Notifications.scheduleNotificationAsync({
    content: { title: copy.title, body: copy.body },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 3 },
  });
}
