import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Which announcement this device has already dismissed.
 *
 * Stored by id, for the same reason the update banner stores a version: a
 * boolean would silence every future announcement after the first dismissal.
 */

const KEY = 'nutriai.announce.dismissed';

export async function dismissedAnnouncement(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export async function rememberAnnouncementDismissal(id: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, id);
  } catch {
    // Failing to remember means the banner comes back once more, which is
    // better than throwing inside a dismiss handler.
  }
}
