import { ShareStats } from '@/api/dashboard';

/**
 * Picks the card's headline from whatever the day actually earned, so the
 * card says something specific rather than a generic "here are my macros".
 * Ported from the web app's share.ts so both surfaces tell the same story;
 * order matters — the rarest achievement wins.
 */
export function pickCaption(s: ShareStats): { headline: string; sub: string } {
  const proteinHit = s.protein.goal != null && s.protein.consumed >= s.protein.goal;
  const underCals =
    s.calories.goal != null && s.calories.consumed > 0 && s.calories.consumed <= s.calories.goal;

  if (s.streak >= 7) {
    return { headline: `${s.streak} DAYS.\nNO MISSES.`, sub: 'Consistency is the whole game.' };
  }
  if (proteinHit) {
    return { headline: 'PROTEIN,\nDEMOLISHED.', sub: 'Fueling the gains.' };
  }
  if (s.steps != null && s.steps >= 10000) {
    return { headline: `${s.steps.toLocaleString()}\nSTEPS DEEP.`, sub: 'Earning it, one step at a time.' };
  }
  if (underCals) {
    return { headline: 'DIALED\nIN.', sub: 'Calories in check, goals in sight.' };
  }
  if (s.calories.consumed > 0) {
    return { headline: 'SHOWING UP.\nEVERY DAY.', sub: 'Progress is a habit.' };
  }
  return { headline: "TODAY'S\nTHE DAY.", sub: 'Log your first meal.' };
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** "27 JUL 2026" — matches the web card's date treatment. */
export function formatCardDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}
