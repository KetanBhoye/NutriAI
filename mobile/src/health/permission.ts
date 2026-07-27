import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Remembers that the user has connected their health store.
 *
 * HealthKit deliberately refuses to report *read* authorisation — returning
 * "not determined" whether you were denied or simply have no data, so that an
 * app can't infer health facts from the permission state. That means there is
 * no API to ask "am I still connected?"; the only options are to remember that
 * we asked and then attempt a read.
 *
 * Without this the You tab re-ran `isAvailable()` on every mount and always
 * fell back to "Connect Apple Health", even for users who connected weeks ago.
 */

const KEY = 'nutriai.health.connected';

export async function markHealthConnected(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, '1');
  } catch {
    // Non-fatal: worst case the user sees the connect prompt again.
  }
}

export async function wasHealthConnected(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    return false;
  }
}

export async function clearHealthConnected(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
