import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The dot on the Trends tab that says this week's insights are waiting.
 *
 * The Sunday notification is easy to miss — it arrives once, and a phone that
 * was face-down at seven in the evening never shows it again. The badge is the
 * quiet second chance: it sits there for the rest of Sunday, so opening the app
 * at any point that day makes it obvious there is something new to read.
 *
 * It clears the moment Trends is opened, not on a timer. A badge that outlives
 * the thing it points at is how people learn to ignore badges.
 *
 * Deliberately **not** an app-icon badge. Those need a notification permission
 * on iOS, are honoured inconsistently by Android launchers, and — most of all —
 * an icon badge reads as "you have unread messages", an obligation. A dot on a
 * tab inside the app is an offer.
 */

const SEEN_KEY = 'nutriai.weekly.badgeSeen';

/** Sunday. `Date.getDay()` counts from Sunday = 0. */
const REPORT_DAY = 0;

export function isReportDay(date: Date = new Date()): boolean {
  return date.getDay() === REPORT_DAY;
}

/**
 * @param today The user's local calendar day.
 */
export async function shouldShowWeeklyBadge(today: string, now: Date = new Date()): Promise<boolean> {
  if (!isReportDay(now)) return false;
  try {
    // Stored as the date it was dismissed, so next Sunday shows it again
    // without any expiry logic.
    return (await AsyncStorage.getItem(SEEN_KEY)) !== today;
  } catch {
    // A storage failure should not cost the user the notice.
    return true;
  }
}

export async function markWeeklyBadgeSeen(today: string): Promise<void> {
  try {
    await AsyncStorage.setItem(SEEN_KEY, today);
  } catch {
    // Worst case the dot reappears; never worth throwing at a screen open.
  }
}

/** Lets Trends tell the tab bar to drop the dot. Same shape as `goalsBus`. */
type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeWeeklyBadge(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitWeeklyBadgeChanged(): void {
  for (const l of listeners) l();
}
