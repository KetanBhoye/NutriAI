/**
 * What the weekly-report notification says.
 *
 * The job is to be worth tapping. "Your weekly report is ready" is true and
 * completely inert — it tells the user nothing they could not have guessed, so
 * they learn to ignore it by the third week.
 *
 * What makes a notification worth opening is an **open loop**: a real number
 * from their own week, and a reason to want the rest of it. "You averaged
 * 142 g protein — your best week yet. See what it did to the trend." The
 * number proves it is about them; the second half is the reason to tap.
 *
 * The hard constraint: a local notification's text is fixed when it is
 * scheduled, and these are armed up to four weeks ahead. So a line may only
 * quote figures that were true **at scheduling time** and cannot become false
 * — which is why the specific variants are used for the week just ended, and
 * everything scheduled further out falls back to copy that is true whenever it
 * lands. Promising "your best week yet" for a week that has not happened would
 * be a lie the app cannot take back.
 */

export interface WeekSummary {
  daysLogged: number;
  /** Whole days, of the seven. */
  daysOnCalorieTarget: number;
  avgProteinG: number | null;
  proteinGoalG: number | null;
  /** Negative means weight lost over the window. */
  weightChangeKg: number | null;
  losingWeight: boolean;
  streakDays: number;
}

export interface WeeklyNotice {
  title: string;
  body: string;
}

const round = (n: number) => Math.round(n);

/**
 * Copy for a week that has already happened, so every figure is settled.
 *
 * Ordered by how much a person would want to read it: a real change on the
 * scale beats a streak, which beats an average.
 */
export function weeklyNotice(week: WeekSummary): WeeklyNotice {
  // Nothing to report on is still worth a nudge, but an honest one.
  if (week.daysLogged === 0) {
    return {
      title: 'Your week, whenever you are ready',
      body: 'Nothing logged this week — one day is enough to start the picture again.',
    };
  }

  if (week.weightChangeKg != null && Math.abs(week.weightChangeKg) >= 0.3) {
    const down = week.weightChangeKg < 0;
    const size = Math.abs(week.weightChangeKg).toFixed(1);
    const good = down === week.losingWeight;
    return {
      title: good ? `${size} kg ${down ? 'down' : 'up'} this week` : 'Your week is in',
      body: good
        ? 'Your report explains which part of the week did it — and what to keep doing.'
        : `The scale went ${down ? 'down' : 'up'} ${size} kg. Your report has the likely reason.`,
    };
  }

  if (week.streakDays >= 7) {
    return {
      title: `${week.streakDays} days logged in a row`,
      body: 'Your weekly report is ready. See what the streak has actually changed.',
    };
  }

  if (week.avgProteinG != null && week.proteinGoalG && week.avgProteinG >= week.proteinGoalG) {
    return {
      title: `You averaged ${round(week.avgProteinG)} g protein`,
      body: `Past your ${round(week.proteinGoalG)} g target every day this week. Your report shows what it is doing to the trend.`,
    };
  }

  if (week.daysOnCalorieTarget >= 5) {
    return {
      title: `${week.daysOnCalorieTarget} of 7 days on target`,
      body: 'Your weekly report is ready — including the two that were not, and why they matter less than you would think.',
    };
  }

  return {
    title: `Your week in numbers is ready`,
    body: `${week.daysLogged} ${week.daysLogged === 1 ? 'day' : 'days'} logged. See what the pattern says, and the one thing worth changing.`,
  };
}

/**
 * Copy for a week that has not happened yet.
 *
 * Scheduled weeks ahead, so it can promise nothing specific — but it can still
 * be a reason to look rather than an announcement. Rotated so a regular user
 * is not read the same sentence every Sunday for a month.
 */
export function genericWeeklyNotice(weekIndex: number): WeeklyNotice {
  const variants: WeeklyNotice[] = [
    {
      title: 'Your week in numbers is ready',
      body: 'Seven days of logging, read back to you — including the one thing worth changing.',
    },
    {
      title: 'This week, summed up',
      body: 'What moved, what did not, and what your next week should look like.',
    },
    {
      title: 'Your weekly report has landed',
      body: 'The trend, the misses, and what the arithmetic says happens next.',
    },
    {
      title: 'A week of data is in',
      body: 'See what your logging actually added up to — it is rarely what people expect.',
    },
  ];
  return variants[weekIndex % variants.length]!;
}
