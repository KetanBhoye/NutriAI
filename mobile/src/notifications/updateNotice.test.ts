import { beforeEach, describe, expect, it, vi } from 'vitest';

const scheduleNotificationAsync = vi.fn();
const getPermissionsAsync = vi.fn();
const checkForUpdate = vi.fn();

vi.mock('expo-notifications', () => ({
  scheduleNotificationAsync: (...a: unknown[]) => scheduleNotificationAsync(...a),
  getPermissionsAsync: () => getPermissionsAsync(),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));

vi.mock('@/updates', () => ({
  UPDATES_SUPPORTED: true,
  checkForUpdate: () => checkForUpdate(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearUpdateNotice, notifyIfUpdateAvailable } from './updateNotice';

beforeEach(async () => {
  scheduleNotificationAsync.mockReset().mockResolvedValue('id');
  getPermissionsAsync.mockReset().mockResolvedValue({ granted: true });
  checkForUpdate.mockReset().mockResolvedValue({ available: true, latestVersion: '1.0.4' });
  await AsyncStorage.removeItem('nutriai.updates.notifiedVersion');
});

describe('notifyIfUpdateAvailable', () => {
  it('announces a newer build once', async () => {
    expect(await notifyIfUpdateAvailable()).toBe(true);

    const body = scheduleNotificationAsync.mock.calls[0]![0] as {
      content: { title: string; body: string };
    };
    expect(body.content.title).toContain('1.0.4');
    // People's first worry about updating is losing their log.
    expect(body.content.body).toMatch(/stays exactly as it is/);
  });

  it('does not repeat itself for the same version', async () => {
    await notifyIfUpdateAvailable();
    scheduleNotificationAsync.mockClear();

    expect(await notifyIfUpdateAvailable()).toBe(false);
    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('announces the next version after that one', async () => {
    await notifyIfUpdateAvailable();
    checkForUpdate.mockResolvedValue({ available: true, latestVersion: '1.0.5' });

    expect(await notifyIfUpdateAvailable()).toBe(true);
  });

  it('says nothing when already up to date', async () => {
    checkForUpdate.mockResolvedValue({ available: false, latestVersion: '1.0.4' });

    expect(await notifyIfUpdateAvailable()).toBe(false);
  });

  it('stays silent when the check fails, rather than erroring on launch', async () => {
    checkForUpdate.mockRejectedValue(new Error('offline'));

    await expect(notifyIfUpdateAvailable()).resolves.toBe(false);
  });

  it('does not notify without notification permission', async () => {
    getPermissionsAsync.mockResolvedValue({ granted: false });

    expect(await notifyIfUpdateAvailable()).toBe(false);
    // ...and does not record it as announced, so it can announce once granted.
    getPermissionsAsync.mockResolvedValue({ granted: true });
    expect(await notifyIfUpdateAvailable()).toBe(true);
  });

  it('can be reset so a later version announces again', async () => {
    await notifyIfUpdateAvailable();
    await clearUpdateNotice();

    expect(await notifyIfUpdateAvailable()).toBe(true);
  });
});
