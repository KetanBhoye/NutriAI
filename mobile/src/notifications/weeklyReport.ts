import * as Notifications from 'expo-notifications';
import { addDays, todayISO } from '@/dates';
import { MEAL_CHANNEL_ID, channelFor, ensureChannels } from './channels';
import { genericWeeklyNotice, weeklyNotice, type WeekSummary } from './weeklyCopy';
import { remindersEnabled } from './reminders';

/**
 * The Sunday-evening nudge that the week's report is worth reading.
 *
 * Local, like everything else here — the app has no push infrastructure (see
 * reminders.ts). The consequence is the same one the meal reminders live with:
 * the text is fixed when the notification is scheduled, so only the *imminent*
 * one can quote real figures. Weeks further out get copy that will still be
 * true whenever it lands.
 *
 * Identifiers are dated, for the reason set out in reminders.ts: an offset
 * means a different week depending on when it was written, which is how a
 * stale notification survives a reschedule and arrives in place of the current
 * one.
 */

const PREFIX = 'nutriai.weekly-report';
/** Sunday. `Date.getDay()` counts from Sunday = 0. */
const REPORT_DAY = 0;
/**
 * 19:00. Not 11:00, which is when the breakfast reminder fires — two
 * notifications in the same second is the "reminders piling up" complaint this
 * app has already had once, and the weekly one would lose that contest to a
 * nudge people see every day.
 */
const REPORT_HOUR = 19;
/** Four Sundays ahead: enough that a lapsed user still hears from the app. */
const WEEKS_AHEAD = 4;

const idFor = (isoDate: string) => `${PREFIX}.${isoDate}`;

/** The next `REPORT_DAY` at `REPORT_HOUR`, starting from today. */
function nextReportDates(): Date[] {
  const out: Date[] = [];
  const first = new Date();
  first.setHours(REPORT_HOUR, 0, 0, 0);

  // Days until the next Sunday; 0 means today, which counts only if the hour
  // has not already passed.
  const ahead = (REPORT_DAY - first.getDay() + 7) % 7;
  first.setDate(first.getDate() + ahead);
  if (first.getTime() <= Date.now()) first.setDate(first.getDate() + 7);

  for (let i = 0; i < WEEKS_AHEAD; i += 1) {
    const d = new Date(first);
    d.setDate(d.getDate() + i * 7);
    out.push(d);
  }
  return out;
}

/** The local calendar day of a Date, without going near UTC. */
const isoOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Arms the weekly notice. Safe to call on every launch — same identifier
 * replaces in place, so re-arming never leaves a gap.
 *
 * @param week The week just gone, when it is known. Only the soonest
 *   notification can use it; the rest cannot quote a week that has not
 *   happened.
 */
export async function scheduleWeeklyReport(week?: WeekSummary | null): Promise<void> {
  // Riding on the reminders switch rather than adding a second one: a user who
  // turned reminders off has said what they think about being notified.
  if (!(await remindersEnabled())) {
    await cancelWeeklyReport();
    return;
  }

  await ensureChannels();

  const dates = nextReportDates();
  const wanted = new Set<string>();

  for (const [i, date] of dates.entries()) {
    const copy = i === 0 && week ? weeklyNotice(week) : genericWeeklyNotice(i);
    const identifier = idFor(isoOf(new Date(date)));
    wanted.add(identifier);

    await Notifications.scheduleNotificationAsync({
      identifier,
      content: { title: copy.title, body: copy.body },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date,
        ...channelFor(MEAL_CHANNEL_ID),
      },
    });
  }

  // Only now clear what is no longer wanted, so there is never a moment with
  // nothing armed.
  const stale: string[] = [];
  for (let offset = -14; offset <= WEEKS_AHEAD * 7 + 7; offset += 1) {
    const id = idFor(addDays(todayISO(), offset));
    if (!wanted.has(id)) stale.push(id);
  }
  await Promise.all(
    stale.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {}))
  );
}

export async function cancelWeeklyReport(): Promise<void> {
  const ids: string[] = [];
  for (let offset = -14; offset <= WEEKS_AHEAD * 7 + 7; offset += 1) {
    ids.push(idFor(addDays(todayISO(), offset)));
  }
  await Promise.all(
    ids.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {}))
  );
}
