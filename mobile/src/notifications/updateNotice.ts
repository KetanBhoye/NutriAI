import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { checkForUpdate, UPDATES_SUPPORTED } from '@/updates';

/**
 * Tells the user, once, when a newer build has been published.
 *
 * This is a **local** notification triggered by the app's own version check,
 * not a server push — NutriAI has no push infrastructure (see reminders.ts for
 * why). The practical consequence: it can only fire while the app is running,
 * so it lands on launch rather than the moment a release goes out. That is
 * enough for the job, and it costs nothing.
 *
 * Only ever once per version. An update reminder that reappears on every
 * launch is the fastest way to have notifications turned off entirely.
 */

const NOTIFIED_KEY = 'nutriai.updates.notifiedVersion';
const IDENTIFIER = 'nutriai.update-available';

/** Test seam, and used when the user updates so the next version can notify. */
export async function clearUpdateNotice(): Promise<void> {
  await AsyncStorage.removeItem(NOTIFIED_KEY);
}

export async function notifyIfUpdateAvailable(): Promise<boolean> {
  if (!UPDATES_SUPPORTED) return false;

  let latest: string | null = null;
  try {
    const check = await checkForUpdate();
    if (!check.available || !check.latestVersion) return false;
    latest = check.latestVersion;
  } catch {
    // A failed check is not worth a notification, or an error, or a retry.
    return false;
  }

  // Already told them about this one.
  if ((await AsyncStorage.getItem(NOTIFIED_KEY)) === latest) return false;

  const perms = await Notifications.getPermissionsAsync();
  if (!perms.granted) return false;

  await Notifications.scheduleNotificationAsync({
    identifier: IDENTIFIER,
    content: {
      title: `NutriAI ${latest} is ready`,
      body: 'Open You → App version to install it. Everything you have logged stays exactly as it is.',
    },
    // A few seconds out rather than immediately: firing during launch competes
    // with the splash screen and is easy to miss.
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 6 },
  });

  await AsyncStorage.setItem(NOTIFIED_KEY, latest);
  return true;
}
