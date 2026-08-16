import AsyncStorage from '@react-native-async-storage/async-storage';
import { isDailyMoment, type MomentKey } from './moments';

/**
 * What has already been celebrated.
 *
 * Two horizons, because two kinds of milestone:
 *
 *  - **Daily** targets (protein, steps, a full day) reset each morning. Hit
 *    your protein goal today and tomorrow, and both are worth a nod.
 *  - **Streaks and weight** are once, ever. Congratulating someone on their
 *    "7-day streak" again on day eight, and day nine, is exactly how this
 *    stops being a reward and becomes something people swipe away unread.
 *
 * Stored locally rather than server-side on purpose: it is a presentation
 * detail, and losing it means at worst one repeated nod on a new device —
 * which is far cheaper than another table and another sync path.
 */

const DAILY_KEY = 'nutriai.celebrate.daily';
const FOREVER_KEY = 'nutriai.celebrate.forever';

interface DailyRecord {
  date: string;
  keys: MomentKey[];
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Everything already celebrated that still counts as celebrated today. */
export async function seenMoments(today: string): Promise<MomentKey[]> {
  const daily = await readJson<DailyRecord>(DAILY_KEY, { date: '', keys: [] });
  const forever = await readJson<MomentKey[]>(FOREVER_KEY, []);
  // Yesterday's daily keys are not today's.
  const todays = daily.date === today ? daily.keys : [];
  return [...todays, ...forever];
}

export async function rememberMoment(key: MomentKey, today: string): Promise<void> {
  try {
    if (isDailyMoment(key)) {
      const daily = await readJson<DailyRecord>(DAILY_KEY, { date: '', keys: [] });
      const keys = daily.date === today ? [...new Set([...daily.keys, key])] : [key];
      await AsyncStorage.setItem(DAILY_KEY, JSON.stringify({ date: today, keys }));
      return;
    }
    const forever = await readJson<MomentKey[]>(FOREVER_KEY, []);
    await AsyncStorage.setItem(FOREVER_KEY, JSON.stringify([...new Set([...forever, key])]));
  } catch {
    // Failing to remember means a repeat at worst. Never worth throwing into
    // the render that just celebrated something.
  }
}
