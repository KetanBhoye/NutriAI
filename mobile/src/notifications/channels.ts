import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

/**
 * Android notification channels.
 *
 * A notification scheduled without a channel lands in the app's default one,
 * which Android creates at `IMPORTANCE_DEFAULT`: no heads-up banner, and on
 * several vendor skins no sound either. A meal reminder that appears silently
 * in the shade an hour later is, to the person who asked to be reminded,
 * indistinguishable from one that never arrived — which is exactly what people
 * report.
 *
 * Channels are created once and are then **owned by the user**: Android
 * ignores later changes to importance, sound or vibration for a channel that
 * already exists. So the id carries a version — changing the constant creates
 * a fresh channel with the new settings rather than silently keeping the old
 * ones. (Deleting and recreating the same id doesn't work either: Android
 * remembers the user's settings for a deleted channel and restores them.)
 *
 * No-ops on iOS, which has no channels.
 */

export const MEAL_CHANNEL_ID = 'meal-reminders-v2';
export const UPDATE_CHANNEL_ID = 'app-updates-v1';

let ensured = false;

export async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android' || ensured) return;
  ensured = true;

  await Notifications.setNotificationChannelAsync(MEAL_CHANNEL_ID, {
    name: 'Meal reminders',
    description: 'Nudges at breakfast, lunch, snack and dinner time.',
    // MAX rather than HIGH: this is the one thing the user turned reminders on
    // for, and it's four notifications a day, not a feed.
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
    enableVibrate: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });

  await Notifications.setNotificationChannelAsync(UPDATE_CHANNEL_ID, {
    name: 'App updates',
    description: 'Tells you when a new version of NutriAI is available.',
    // Deliberately quieter than reminders — useful, but never urgent.
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default',
  });
}

/** `channelId` is Android-only; passing it on iOS is harmless but pointless. */
export function channelFor(id: string): { channelId?: string } {
  return Platform.OS === 'android' ? { channelId: id } : {};
}
