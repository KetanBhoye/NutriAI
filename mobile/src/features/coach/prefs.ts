import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Hands-free mode, remembered.
 *
 * It's a mode, not a one-off action: someone cooking with a phone on the
 * counter turns it on and expects it on tomorrow, and someone on a train wants
 * it to stay off. Storing it also keeps the two halves in step — dictation
 * auto-sending and replies being read aloud are one decision, not two.
 */

const KEY = 'nutriai.coach.handsFree';

export async function loadHandsFree(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    // Off is the safe default: a phone that starts talking unprompted is worse
    // than one that doesn't talk at all.
    return false;
  }
}

export async function saveHandsFree(on: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // A preference that didn't persist is not worth breaking the screen over.
  }
}
