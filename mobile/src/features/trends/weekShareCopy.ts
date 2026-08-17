import type { Consistency } from '@/api/dashboard';
import type { CardTheme } from '../today/ShareCardBackground';

/**
 * What the weekly share card says, and what colour it says it in.
 *
 * The daily card celebrates one day; this one is about a week holding
 * together, so the hero is the consistency score rather than a single stat.
 *
 * Two rules the copy follows, both carried over from the score itself:
 *
 *   - It never posts a bad week. A card is something the user chose to show
 *     other people, so the threshold to *offer* it is higher than the
 *     threshold to show a number in the app. Below that, sharing is not
 *     offered at all rather than offered with sad copy.
 *   - The peer line only appears when the server sent one. It is the smallest
 *     line on the card, because a share people are proud of is about what they
 *     did, not about who they beat.
 */

/**
 * Below this the card is not offered.
 *
 * Not a judgement about the week — it is that a story card is a public act,
 * and handing someone a shareable "you managed 22" is a strange thing to do.
 * They still see the score in the app, with copy written to encourage.
 */
export const MIN_SHAREABLE_SCORE = 45;

/** And a week with almost nothing logged has nothing to show. */
export const MIN_SHAREABLE_DAYS = 3;

export function canShareWeek(data: Consistency): boolean {
  return data.score >= MIN_SHAREABLE_SCORE && data.days_logged >= MIN_SHAREABLE_DAYS;
}

/**
 * Week cards use the cool half of the palette set, never the day card's warm
 * magenta/gold. Rendered side by side on the old shared palette the two were
 * indistinguishable at thumbnail size — same gradient, same shape, different
 * numbers — which is exactly what "they should not overlap" meant.
 */
export function themeFor(data: Consistency): CardTheme {
  if (data.is_personal_best && data.score > 0) return 'week-best';
  switch (data.headline.band) {
    case 'excellent':
    case 'strong':
      return 'week-strong';
    case 'steady':
      return 'week-steady';
    default:
      return 'week-building';
  }
}

export interface WeekShareCopy {
  /** Two or three words, set large. */
  eyebrow: string;
  /** The line under the score. Short enough not to wrap at card width. */
  headline: string;
}

export function weekShareCopy(data: Consistency): WeekShareCopy {
  if (data.is_personal_best && data.score > 0) {
    return { eyebrow: 'PERSONAL BEST', headline: 'My steadiest week yet' };
  }
  if (data.score >= 85) {
    return { eyebrow: 'THIS WEEK', headline: 'Locked in all week' };
  }
  if (data.previous_score !== null && data.score > data.previous_score) {
    return { eyebrow: 'THIS WEEK', headline: `Up ${data.score - data.previous_score} on last week` };
  }
  if (data.days_logged >= 7) {
    return { eyebrow: 'THIS WEEK', headline: 'Logged every single day' };
  }
  return { eyebrow: 'THIS WEEK', headline: `${data.days_logged} days tracked` };
}

/**
 * The caption pre-filled into the share sheet. Deliberately short: people
 * rewrite long ones, and a caption that reads as marketing gets deleted.
 */
export function weekShareCaption(data: Consistency): string {
  const copy = weekShareCopy(data);
  return `${copy.headline} — consistency ${data.score}/100`;
}

/** `2026-08-17` → `17 Aug`, for the small date range on the card. */
export function shortDate(iso: string): string {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(ms)) return iso;
  const d = new Date(ms);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
    d.getUTCMonth()
  ];
  return `${d.getUTCDate()} ${month}`;
}

/** The `17–23 Aug` range under the title. */
export function weekRangeLabel(weekStart: string): string {
  const endMs = Date.parse(`${weekStart}T00:00:00Z`) + 6 * 86_400_000;
  return `${shortDate(weekStart)} – ${shortDate(new Date(endMs).toISOString().slice(0, 10))}`;
}
