import { ShareStats } from '@/api/dashboard';
import type { CardTheme } from './ShareCardBackground';

/**
 * What the card says, and how it looks.
 *
 * Two things this deliberately does:
 *
 * 1. **The theme comes back with the caption**, rather than being recovered by
 *    grepping the headline for words like "PROTEIN". That was fragile — any new
 *    caption containing the word would silently repaint the card — and it made
 *    adding lines risky enough that nobody did.
 *
 * 2. **Each tier has several variants, chosen by the date.** A card that reads
 *    the same every single day is a card people post once. Rotating on the date
 *    keeps it fresh across a week while staying stable *within* a day, so the
 *    preview and the shared image never disagree — and so this stays testable.
 */

export interface Caption {
  headline: string;
  sub: string;
  theme: CardTheme;
}

/** Stable per-day index into a variant list. Same day in, same caption out. */
function variantFor(date: string, count: number): number {
  let hash = 0;
  for (let i = 0; i < date.length; i++) hash = (hash * 31 + date.charCodeAt(i)) >>> 0;
  return hash % count;
}

function pick(date: string, theme: CardTheme, options: Array<[string, string]>): Caption {
  const [headline, sub] = options[variantFor(date, options.length)]!;
  return { headline, sub, theme };
}

/**
 * Picks the card's headline from whatever the day actually earned.
 *
 * Order matters: the rarest achievement wins, so a clean sweep outranks
 * hitting protein alone. A card that led with the smallest win would undersell
 * the day, and this is the screen people judge the app by.
 *
 * Every tier here is a *day* fact. Streaks and weight trends are deliberately
 * absent — they are the weekly card's story, and a day card that tells it too
 * is just a worse weekly card.
 */
export function pickCaption(s: ShareStats): Caption {
  const d = s.date;
  const proteinHit = s.protein.goal != null && s.protein.consumed >= s.protein.goal;
  const underCals =
    s.calories.goal != null && s.calories.consumed > 0 && s.calories.consumed <= s.calories.goal;
  const stepsHit = s.steps != null && s.steps >= 10000;
  const lost = s.weight_change_kg != null && s.weight_change_kg <= -0.3;

  // Everything at once. Rare enough to deserve its own look.
  if (proteinHit && underCals && stepsHit) {
    return pick(d, 'perfect', [
      ['PERFECT\nDAY.', 'Calories, protein, steps. All of it.'],
      ['NOTHING\nMISSED.', 'The kind of day results are made of.'],
      ['CLEAN\nSWEEP.', 'Every target, no excuses.'],
    ]);
  }

  /*
   * Streak and weight-trend tiers used to live here, above every day-scale
   * achievement — so a good day led with "A WEEK STRONG / Every day logged",
   * which is a *week* claim on a card about one day. Seeing it rendered next
   * to the weekly card made it obvious they were competing for the same story.
   *
   * Both moved out rather than down: the weekly card owns the streak, and the
   * weight trend belongs to Plan. What is left is what actually happened
   * today, which is the only thing this card can honestly claim.
   */

  if (proteinHit) {
    return pick(d, 'protein', [
      ['PROTEIN,\nDEMOLISHED.', 'Fuelling the gains.'],
      ['TARGET\nHIT.', `${Math.round(s.protein.consumed)}g of protein in the bank.`],
      ['MUSCLE\nFED.', 'Every gram earned.'],
    ]);
  }

  if (s.steps != null && s.steps >= 15000) {
    return pick(d, 'steps', [
      [`${s.steps.toLocaleString()}\nSTEPS.`, 'That is not a walk. That is a commitment.'],
      ['LEGS\nEARNED IT.', `${s.steps.toLocaleString()} steps today.`],
    ]);
  }

  if (stepsHit) {
    return pick(d, 'steps', [
      [`${s.steps!.toLocaleString()}\nSTEPS DEEP.`, 'Earning it, one step at a time.'],
      ['TEN\nTHOUSAND.', 'The number everyone talks about. Done.'],
    ]);
  }

  if (underCals) {
    return pick(d, 'dialed', [
      ['DIALED\nIN.', 'Calories in check, goals in sight.'],
      ['UNDER\nBUDGET.', 'Small margins, compounded daily.'],
      ['HELD THE\nLINE.', 'The boring days build the body.'],
    ]);
  }

  if (s.calories.consumed > 0) {
    return pick(d, 'default', [
      ['SHOWING UP.\nEVERY DAY.', 'Progress is a habit, not an event.'],
      ['LOGGED.\nTRACKED.', 'You cannot change what you do not measure.'],
      ['ANOTHER\nONE DOWN.', 'Not every day is a highlight. They all count.'],
    ]);
  }

  return pick(d, 'default', [
    ["TODAY'S\nTHE DAY.", 'Log your first meal.'],
    ['CLEAN\nSLATE.', 'The day is yours. Start it.'],
  ]);
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** "27 JUL 2026" — matches the web card's date treatment. */
export function formatCardDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}
