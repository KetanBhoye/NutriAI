import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Scheduling. The copy itself is covered in copy.test.ts.
 *
 * Two properties matter more than anything else here, because both produced
 * user-visible failures: reminders must never be cancelled before their
 * replacements exist, and the pending count must stay under iOS's cap.
 */

const scheduleNotificationAsync = vi.fn();
const cancelScheduledNotificationAsync = vi.fn();
const getPermissionsAsync = vi.fn();
const requestPermissionsAsync = vi.fn();
const getEntries = vi.fn();
const getGoals = vi.fn();

vi.mock('expo-notifications', () => ({
  scheduleNotificationAsync: (...a: unknown[]) => scheduleNotificationAsync(...a),
  cancelScheduledNotificationAsync: (...a: unknown[]) => cancelScheduledNotificationAsync(...a),
  getPermissionsAsync: () => getPermissionsAsync(),
  requestPermissionsAsync: () => requestPermissionsAsync(),
  SchedulableTriggerInputTypes: { DATE: 'date', TIME_INTERVAL: 'timeInterval', DAILY: 'daily' },
}));

vi.mock('@/api', () => ({
  entriesApi: { getEntries: (d: string) => getEntries(d) },
  goalsApi: { getGoals: () => getGoals() },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { addDays, todayISO } from '@/dates';

/**
 * Reminders are identified by the date they are for, so the tests name real
 * days too. Matching on an offset (`.0.`, `.1.`) was how the identifiers used
 * to work, and it is exactly the ambiguity that let a stale reminder survive a
 * reschedule and arrive in place of the current one.
 */
// Functions, not constants: the suite runs on a fake clock set in
// `beforeEach`, and a constant evaluated at module load would capture the real
// date instead of the pretend one.
const today = () => todayISO();
const tomorrow = () => addDays(todayISO(), 1);
import {
  initialiseReminders,
  remindersEnabled,
  scheduleMealReminders,
  sendPreviewReminder,
  setRemindersEnabled,
} from './reminders';

const scheduled = () =>
  scheduleNotificationAsync.mock.calls.map(
    (c) => c[0] as { identifier?: string; content: { title: string; body: string }; trigger: { date?: Date } }
  );

const entries = (list: Array<{ meal_type: string; calories: number; protein_g?: number }> = []) =>
  getEntries.mockResolvedValue({ entries: list });

beforeEach(async () => {
  vi.useFakeTimers();
  // Mid-morning, before every slot, so a full day is schedulable.
  vi.setSystemTime(new Date('2026-08-14T09:00:00'));
  scheduleNotificationAsync.mockReset().mockResolvedValue('id');
  cancelScheduledNotificationAsync.mockReset().mockResolvedValue(undefined);
  getPermissionsAsync.mockReset().mockResolvedValue({ granted: true });
  requestPermissionsAsync.mockReset().mockResolvedValue({ granted: true });
  getGoals.mockReset().mockResolvedValue({ macros: { calories: 2000, protein_g: 150 } });
  entries();
  await AsyncStorage.removeItem('nutriai.reminders.enabled');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('defaults', () => {
  it('is on before the user has chosen anything', async () => {
    // A reminder app whose reminders are off by default is a habit tracker
    // nobody builds a habit with.
    expect(await remindersEnabled()).toBe(true);
  });

  it('keeps an explicit opt-out', async () => {
    await setRemindersEnabled(false);
    expect(await remindersEnabled()).toBe(false);
  });

  it('does not re-prompt someone who already opted in but was refused by the OS', async () => {
    await AsyncStorage.setItem('nutriai.reminders.enabled', '1');
    getPermissionsAsync.mockResolvedValue({ granted: false });

    await initialiseReminders();

    expect(requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('asks once on a genuine first run', async () => {
    getPermissionsAsync.mockResolvedValue({ granted: false });

    await initialiseReminders();

    expect(requestPermissionsAsync).toHaveBeenCalled();
  });
});

describe('scheduleMealReminders', () => {
  it('covers four meals a day for a week, under iOS\'s 64 pending cap', async () => {
    await scheduleMealReminders();

    expect(scheduled().length).toBeLessThanOrEqual(28);
    expect(scheduled().length).toBeGreaterThan(20);
  });

  it('fires at 11:00, 14:00, 18:00 and 20:30', async () => {
    await scheduleMealReminders();

    const todayTimes = scheduled()
      .map((s) => s.trigger.date!)
      .filter((d) => d.getDate() === 14)
      .map((d) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`);

    expect(todayTimes).toEqual(['11:00', '14:00', '18:00', '20:30']);
  });

  it('never cancels before the replacements are scheduled', async () => {
    // The bug this exists to prevent: the old version cancelled everything and
    // then made network calls before rescheduling. Backgrounding mid-flight
    // left the user with no reminders at all, which is why they arrived only
    // sometimes.
    const order: string[] = [];
    scheduleNotificationAsync.mockImplementation(async () => {
      order.push('schedule');
      return 'id';
    });
    cancelScheduledNotificationAsync.mockImplementation(async () => {
      order.push('cancel');
    });

    await scheduleMealReminders();

    expect(order[0]).toBe('schedule');
  });

  it('survives the API being unreachable, with generic copy', async () => {
    // Losing the number in a reminder is much better than losing the reminder.
    getEntries.mockRejectedValue(new Error('offline'));
    getGoals.mockRejectedValue(new Error('offline'));

    await scheduleMealReminders();

    expect(scheduled().length).toBeGreaterThan(0);
  });

  it('skips today\'s meals that are already logged', async () => {
    entries([{ meal_type: 'lunch', calories: 600, protein_g: 40 }]);

    await scheduleMealReminders();

    const todayIds = scheduled()
      .map((s) => s.identifier!)
      .filter((id) => id.includes(`.${today()}.`));

    expect(todayIds.some((id) => id.endsWith('.lunch'))).toBe(false);
    expect(todayIds.some((id) => id.endsWith('.dinner'))).toBe(true);
  });

  it('cancels the identifier for a meal that has since been logged', async () => {
    entries([{ meal_type: 'lunch', calories: 600 }]);

    await scheduleMealReminders();

    expect(cancelScheduledNotificationAsync).toHaveBeenCalledWith(
      expect.stringContaining(`.${today()}.lunch`)
    );
  });

  it('quotes what is left today, but never on a future day', async () => {
    entries([{ meal_type: 'breakfast', calories: 500, protein_g: 30 }]);

    await scheduleMealReminders();

    const todays = scheduled().filter((s) => s.identifier!.includes(`.${today()}.`));
    const tomorrows = scheduled().filter((s) => s.identifier!.includes(`.${tomorrow()}.`));

    expect(todays.some((s) => /1,?500 kcal/.test(s.content.body))).toBe(true);
    expect(tomorrows.every((s) => !/kcal left/.test(s.content.body))).toBe(true);
  });

  it('clears everything when reminders are off', async () => {
    await AsyncStorage.setItem('nutriai.reminders.enabled', '0');

    await scheduleMealReminders();

    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(cancelScheduledNotificationAsync).toHaveBeenCalled();
  });

  it('cancels the pre-meal-slots identifiers so upgrades do not keep one alive', async () => {
    await scheduleMealReminders();

    expect(cancelScheduledNotificationAsync).toHaveBeenCalledWith('nutriai.daily-log-reminder');
  });
});

describe('sendPreviewReminder', () => {
  it('fires shortly, with real copy', async () => {
    await sendPreviewReminder();

    const [call] = scheduled();
    expect(call!.content.body.length).toBeGreaterThan(0);
  });
});

describe('identifiers are dated, not offset', () => {
  it('names the day a reminder is for, so it cannot mean a different day later', async () => {
    await scheduleMealReminders();

    // `…meal-reminder.2026-08-14.lunch` is that day's lunch whenever it was
    // written. The offset scheme it replaced (`…meal-reminder.0.lunch`) meant
    // "today" relative to the last scheduling run, so after midnight or a day
    // away the same id claimed a different day — and a reschedule could leave
    // the older notification armed while believing it had replaced it.
    for (const s of scheduled()) {
      expect(s.identifier).toMatch(/\.\d{4}-\d{2}-\d{2}\.(breakfast|lunch|snack|dinner)$/);
    }
  });

  it('sweeps the old offset identifiers, which nothing else would ever reclaim', async () => {
    await scheduleMealReminders();

    const cancelled = cancelScheduledNotificationAsync.mock.calls.map((c) => c[0] as string);

    // Left armed, these keep firing alongside the dated ones — two reminders,
    // one of them older, which is what people reported.
    expect(cancelled).toContain('nutriai.meal-reminder.0.breakfast');
    expect(cancelled).toContain('nutriai.meal-reminder.3.dinner');
  });

  it('cancels days that have already gone, which a dated id no longer overwrites', async () => {
    await scheduleMealReminders();

    const cancelled = cancelScheduledNotificationAsync.mock.calls.map((c) => c[0] as string);
    const yesterday = addDays(todayISO(), -1);

    expect(cancelled).toContain(`nutriai.meal-reminder.${yesterday}.dinner`);
  });
});
