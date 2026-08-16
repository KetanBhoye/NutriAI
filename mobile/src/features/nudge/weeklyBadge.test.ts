import { describe, expect, it } from 'vitest';
import { isReportDay, markWeeklyBadgeSeen, shouldShowWeeklyBadge } from './weeklyBadge';

/** Local noon, so no timezone can push these onto a neighbouring day. */
const at = (iso: string) => new Date(`${iso}T12:00:00`);

const SUNDAY = '2026-08-16';
const MONDAY = '2026-08-17';
const NEXT_SUNDAY = '2026-08-23';

describe('when the badge shows', () => {
  it('shows all day Sunday', async () => {
    expect(isReportDay(at(SUNDAY))).toBe(true);
    expect(await shouldShowWeeklyBadge(SUNDAY, at(SUNDAY))).toBe(true);
  });

  it('shows on no other day', async () => {
    expect(isReportDay(at(MONDAY))).toBe(false);
    expect(await shouldShowWeeklyBadge(MONDAY, at(MONDAY))).toBe(false);
  });

  it('goes away once Trends has been opened', async () => {
    await markWeeklyBadgeSeen(SUNDAY);
    expect(await shouldShowWeeklyBadge(SUNDAY, at(SUNDAY))).toBe(false);
  });

  it('comes back next Sunday without any expiry logic', async () => {
    // Storing the date it was dismissed, rather than a flag, is what makes
    // this work: a different Sunday is simply a different date.
    await markWeeklyBadgeSeen(SUNDAY);
    expect(await shouldShowWeeklyBadge(NEXT_SUNDAY, at(NEXT_SUNDAY))).toBe(true);
  });

  it('stays dismissed for the rest of that Sunday', async () => {
    await markWeeklyBadgeSeen(SUNDAY);
    // Later the same evening, after the notification fires.
    expect(await shouldShowWeeklyBadge(SUNDAY, new Date(`${SUNDAY}T21:30:00`))).toBe(false);
  });

  it('shows early on Sunday, before the notification is due', async () => {
    // The report is for the week just gone, so it is worth reading at 8am as
    // much as at 7pm — the badge is not waiting for the notification.
    expect(await shouldShowWeeklyBadge(SUNDAY, new Date(`${SUNDAY}T08:00:00`))).toBe(true);
  });
});
