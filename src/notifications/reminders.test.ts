import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The reminder is a *local* notification, so the OS fixes its text when it's
 * scheduled. Everything here defends the consequence: only today's copy can
 * quote today's numbers, and a repeating trigger would re-deliver one day's
 * calories forever.
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

import {
  remindersEnabled,
  scheduleDailyReminder,
  sendPreviewReminder,
  setRemindersEnabled,
} from './reminders';

/** The `content.body` of every notification that was scheduled, in order. */
const bodies = () =>
  scheduleNotificationAsync.mock.calls.map((c) => (c[0] as { content: { body: string } }).content.body);

const triggerDates = () =>
  scheduleNotificationAsync.mock.calls
    .map((c) => (c[0] as { trigger: { date?: Date } }).trigger.date)
    .filter((d): d is Date => d instanceof Date);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  // 9am: today's 8pm reminder is still ahead of us.
  vi.setSystemTime(new Date(2026, 6, 17, 9, 0));

  scheduleNotificationAsync.mockResolvedValue('id');
  cancelScheduledNotificationAsync.mockResolvedValue(undefined);
  getPermissionsAsync.mockResolvedValue({ granted: true });
  requestPermissionsAsync.mockResolvedValue({ granted: true });
  getGoals.mockResolvedValue({ macros: { calories: 2000 } });
  getEntries.mockResolvedValue({ entries: [{ calories: 600 }, { calories: 400 }] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('setRemindersEnabled', () => {
  it('schedules once permission is granted', async () => {
    expect(await setRemindersEnabled(true)).toBe(true);
    expect(await remindersEnabled()).toBe(true);
    expect(scheduleNotificationAsync).toHaveBeenCalled();
  });

  it('asks for permission only when it does not already have it', async () => {
    getPermissionsAsync.mockResolvedValue({ granted: false });
    await setRemindersEnabled(true);
    expect(requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('stays off, and schedules nothing, if permission is refused', async () => {
    getPermissionsAsync.mockResolvedValue({ granted: false });
    requestPermissionsAsync.mockResolvedValue({ granted: false });

    expect(await setRemindersEnabled(true)).toBe(false);
    expect(await remindersEnabled()).toBe(false);
    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('cancels everything when switched off', async () => {
    await setRemindersEnabled(true);
    vi.clearAllMocks();

    expect(await setRemindersEnabled(false)).toBe(false);
    expect(await remindersEnabled()).toBe(false);
    expect(cancelScheduledNotificationAsync).toHaveBeenCalled();
    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

describe('scheduleDailyReminder', () => {
  it('does nothing while reminders are off', async () => {
    await scheduleDailyReminder();
    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('schedules a fortnight of one-shots, not one repeating trigger', async () => {
    // A DAILY trigger would re-deliver one day's calorie figures forever.
    await setRemindersEnabled(true);

    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(14);
    for (const call of scheduleNotificationAsync.mock.calls) {
      expect((call[0] as { trigger: { type: string } }).trigger.type).toBe('date');
    }
  });

  it('fires each one at 8pm on consecutive days', async () => {
    await setRemindersEnabled(true);
    const dates = triggerDates();

    expect(dates[0]!.getDate()).toBe(17);
    expect(dates[0]!.getHours()).toBe(20);
    expect(dates[1]!.getDate()).toBe(18);
    expect(dates[13]!.getDate()).toBe(30);
  });

  it('quotes what is left today, but only for today', async () => {
    await setRemindersEnabled(true);
    const [today, tomorrow] = bodies();

    // 2000 goal − 1000 eaten.
    expect(today).toContain('1000 kcal left');
    // Tomorrow cannot know tomorrow's log, so it quotes the target instead.
    expect(tomorrow).toContain('2,000 kcal');
    expect(tomorrow).not.toContain('left today');
  });

  it('nudges differently when nothing is logged yet', async () => {
    getEntries.mockResolvedValue({ entries: [] });
    await setRemindersEnabled(true);
    expect(bodies()[0]).toContain("haven't logged anything");
  });

  it('changes tone once the target is passed', async () => {
    getEntries.mockResolvedValue({ entries: [{ calories: 2400 }] });
    await setRemindersEnabled(true);
    expect(bodies()[0]).toContain('2400 kcal logged');
  });

  it('skips today once 8pm has gone', async () => {
    vi.setSystemTime(new Date(2026, 6, 17, 21, 30));
    await setRemindersEnabled(true);

    // 13 left, starting tomorrow — scheduling a past date would never fire.
    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(13);
    expect(triggerDates()[0]!.getDate()).toBe(18);
  });

  it('clears the previous set first, so reminders cannot stack up', async () => {
    await setRemindersEnabled(true);
    vi.clearAllMocks();

    await scheduleDailyReminder();

    // 14 dated ids plus the legacy repeating one from older builds.
    expect(cancelScheduledNotificationAsync).toHaveBeenCalledTimes(15);
    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(14);
  });

  it('still schedules when the day\'s totals cannot be fetched', async () => {
    // Offline at 9am is no reason to have no reminder at 8pm.
    getEntries.mockRejectedValue(new Error('offline'));
    await setRemindersEnabled(true);

    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(14);
    expect(bodies()[0]).toContain('2,000 kcal');
  });

  it('falls back to generic copy when there is no target at all', async () => {
    getGoals.mockRejectedValue(new Error('offline'));
    getEntries.mockResolvedValue({ entries: [] });
    await setRemindersEnabled(true);

    expect(bodies()[1]).toBe('Anything left to log today?');
  });
});

describe('sendPreviewReminder', () => {
  it('fires shortly, with the same copy as the real thing', async () => {
    await sendPreviewReminder();

    const call = scheduleNotificationAsync.mock.calls[0]![0] as {
      trigger: { type: string; seconds: number };
      content: { body: string };
    };
    expect(call.trigger.type).toBe('timeInterval');
    expect(call.content.body).toContain('1000 kcal left');
  });

  it('works even when reminders are switched off — it is a preview', async () => {
    await setRemindersEnabled(false);
    vi.clearAllMocks();

    await sendPreviewReminder();
    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });
});
