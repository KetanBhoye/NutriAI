import { describe, expect, it } from 'vitest';
import type { Consistency } from '@/api/dashboard';
import { DOWNLOAD_LABEL, DOWNLOAD_URL } from '@/config';
import {
  canShareWeek,
  MIN_SHAREABLE_DAYS,
  MIN_SHAREABLE_SCORE,
  themeFor,
  weekRangeLabel,
  weekShareCaption,
  weekShareCopy,
} from './weekShareCopy';

const week = (over: Partial<Consistency> = {}): Consistency => ({
  available: true,
  week_start: '2026-08-17',
  score: 73,
  days_logged: 6,
  previous_score: 60,
  personal_best: 70,
  is_personal_best: false,
  components: { logging: 86, calories: 71, protein: 64, movement: 55 },
  headline: { band: 'strong', title: 'Up on last week', detail: '' },
  history: [],
  comparison: null,
  ...over,
});

describe('when sharing is offered at all', () => {
  it('is not offered for a weak week', () => {
    // A card is a public act. Handing someone a shareable "you managed 22" is
    // a strange thing to do — they still see the score in-app, with copy
    // written to encourage rather than to broadcast.
    expect(canShareWeek(week({ score: MIN_SHAREABLE_SCORE - 1 }))).toBe(false);
  });

  it('is not offered for a barely-logged week', () => {
    expect(canShareWeek(week({ days_logged: MIN_SHAREABLE_DAYS - 1 }))).toBe(false);
  });

  it('is offered once both thresholds are met', () => {
    expect(canShareWeek(week({ score: MIN_SHAREABLE_SCORE, days_logged: MIN_SHAREABLE_DAYS }))).toBe(
      true
    );
  });
});

describe('the copy', () => {
  it('leads with a personal best when there is one', () => {
    const copy = weekShareCopy(week({ is_personal_best: true }));
    expect(copy.eyebrow).toBe('PERSONAL BEST');
    expect(copy.headline).toMatch(/steadiest/i);
  });

  it('quotes the actual improvement over last week', () => {
    expect(weekShareCopy(week({ score: 73, previous_score: 60 })).headline).toContain('13');
  });

  it('calls out a fully logged week', () => {
    expect(
      weekShareCopy(week({ days_logged: 7, previous_score: 99, score: 70 })).headline
    ).toMatch(/every single day/i);
  });

  it('never says anything self-deprecating', () => {
    // Whatever the week, this text is going on someone's story.
    for (const score of [45, 60, 73, 90, 100]) {
      const copy = weekShareCopy(week({ score }));
      const text = `${copy.eyebrow} ${copy.headline}`.toLowerCase();
      for (const word of ['only', 'just', 'barely', 'failed', 'missed']) {
        expect(text).not.toContain(word);
      }
    }
  });

  it('keeps the headline short enough not to wrap on the card', () => {
    for (const over of [{ is_personal_best: true }, { score: 90 }, { days_logged: 7 }, {}]) {
      expect(weekShareCopy(week(over)).headline.length).toBeLessThanOrEqual(28);
    }
  });
});

describe('the caption', () => {
  it('is short, because long ones get rewritten or deleted', () => {
    expect(weekShareCaption(week()).length).toBeLessThan(60);
  });

  it('carries the score, which is the thing worth stating', () => {
    expect(weekShareCaption(week({ score: 73 }))).toContain('73');
  });
});

describe('the install link', () => {
  it('points at the public site, not whatever backend this build talks to', () => {
    // A dev-pointed build must still share a link real people can install
    // from. Someone screenshots the story and types this in.
    expect(DOWNLOAD_URL).toContain('nutriai-app.up.railway.app');
    expect(DOWNLOAD_URL).not.toContain('nutriai-dev');
    // The printed label is the same address without the scheme.
    expect(DOWNLOAD_URL).toContain(DOWNLOAD_LABEL);
  });
});

describe('the palette', () => {
  const DAY_THEMES = ['perfect', 'streak', 'weight', 'protein', 'steps', 'dialed', 'default'];

  it('never uses a day card palette', () => {
    // The point of the split. Rendered side by side on the shared palette, a
    // week and a day were the same object with different numbers — a shared
    // gradient beats any layout difference at thumbnail size.
    for (const band of ['excellent', 'strong', 'steady', 'building'] as const) {
      for (const best of [true, false]) {
        const theme = themeFor(week({ is_personal_best: best, headline: { band, title: '', detail: '' } }));
        expect(DAY_THEMES).not.toContain(theme);
        expect(theme.startsWith('week-')).toBe(true);
      }
    }
  });

  it('gives a personal best its own treatment', () => {
    expect(themeFor(week({ is_personal_best: true }))).toBe('week-best');
  });

  it('varies by band, so two weeks do not look identical in a feed', () => {
    const themes = (['excellent', 'steady', 'building'] as const).map((band) =>
      themeFor(week({ headline: { band, title: '', detail: '' } }))
    );
    expect(new Set(themes).size).toBe(3);
  });

  it('does not award the personal-best treatment to a zero score', () => {
    expect(themeFor(week({ is_personal_best: true, score: 0 }))).not.toBe('week-best');
  });
});

describe('the date range', () => {
  it('spans Monday to Sunday', () => {
    expect(weekRangeLabel('2026-08-17')).toBe('17 Aug – 23 Aug');
  });

  it('crosses a month boundary', () => {
    expect(weekRangeLabel('2026-07-27')).toBe('27 Jul – 2 Aug');
  });

  it('is computed in UTC, so it cannot shift by a day', () => {
    expect(weekRangeLabel('2026-01-01')).toBe('1 Jan – 7 Jan');
  });
});
