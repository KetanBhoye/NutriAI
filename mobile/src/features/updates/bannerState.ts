import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * "Not now" for the update banner, remembered per version.
 *
 * Storing a boolean would be the obvious mistake: dismiss once and the next
 * release goes unannounced forever. Storing the version means a dismissal is
 * honoured exactly as long as it is still the same news.
 */

const KEY = 'nutriai.updates.bannerDismissed';

export async function dismissedVersion(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export async function rememberDismissal(version: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, version);
  } catch {
    // Failing to remember means the banner comes back — mildly annoying, and
    // strictly better than throwing inside a dismiss handler.
  }
}
