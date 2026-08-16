import { KCAL_PER_KG } from '@/nutrition';

/**
 * What a pattern of missed targets actually costs, in the user's own numbers.
 *
 * A tracker that only says "you missed your protein goal" is telling someone
 * something they already know. The useful part is the second sentence: what
 * happens if this week repeats, expressed as arithmetic they can check, and
 * what to do about it tonight.
 *
 * Three rules keep this honest:
 *
 *  1. **Every projection is arithmetic on their data**, never a claim invented
 *     for effect. A surplus becomes kilograms via the same 7,700 kcal/kg the
 *     plan itself uses; a protein gap is stated as grams short. If a number
 *     cannot be derived, the sentence does not use one.
 *  2. **Only well-established nutrition principles**, stated plainly: protein
 *     supports muscle retention in a deficit, large deficits degrade training
 *     performance. Nothing diagnostic, nothing medical, no scare stories.
 *  3. **A pattern, not a day.** One low day is noise and everybody has them.
 *     These need several days before they say anything, because being told off
 *     for a single Friday is how people delete a tracker.
 *
 * Tone is factual, never scolding. The user is an adult who already knows they
 * ate less protein than they meant to.
 */

/** How many of the recent days must miss before it counts as a pattern. */
const PATTERN_DAYS = 3;
/** Only days with a real log count — an abandoned day is not a low day. */
const COMPLETE_DAY_KCAL = 1200;

export interface DayRecord {
  entry_date: string;
  calories: number;
  protein_g: number;
}

export interface NudgeContext {
  /** Most recent first or last — order does not matter, only membership. */
  recent: DayRecord[];
  calorieGoal: number | null;
  proteinGoal: number | null;
  /** Whether the plan is a deficit; changes what a shortfall means. */
  losingWeight: boolean;
  /** Sessions logged in the last week, for the training framing. */
  trainedRecently: boolean;
}

export type NudgeKey = 'protein-short' | 'over-target' | 'under-eating' | 'not-logging';

export interface Nudge {
  key: NudgeKey;
  title: string;
  /** What their numbers say. Always specific. */
  because: string;
  /** What it means if the pattern holds. Derived, never asserted. */
  ifRepeated: string;
  /** One thing to do, sized to the gap. */
  action: string;
}

const avg = (ns: number[]) => (ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0);
const round = (n: number) => Math.round(n);
const kg = (n: number) => `${n.toFixed(1)} kg`;

/**
 * At most one nudge, or null on a week that needs no comment.
 *
 * Ordered by how much the pattern costs: eating far under the plan does more
 * damage than being slightly over it, and neither matters if the log is too
 * patchy to read.
 */
export function pickNudge(ctx: NudgeContext): Nudge | null {
  const logged = ctx.recent.filter((d) => d.calories >= COMPLETE_DAY_KCAL);

  // Not enough of a record to say anything honest about.
  if (ctx.recent.length >= 5 && logged.length <= ctx.recent.length - PATTERN_DAYS) {
    const missed = ctx.recent.length - logged.length;
    return {
      key: 'not-logging',
      title: `${missed} of the last ${ctx.recent.length} days are missing`,
      because: 'A day without a full log is a day the plan has to guess at.',
      ifRepeated:
        'Your plan sets its calorie target by fitting a rate to what you actually eat and weigh. With gaps, it is fitting to less data, so the target drifts from what your body is really doing.',
      action: 'Log tomorrow end to end, even the days that go badly — especially those.',
    };
  }

  if (logged.length < PATTERN_DAYS) return null;

  // ── eating far under the plan ──────────────────────────────────────────
  if (ctx.calorieGoal) {
    const mean = avg(logged.map((d) => d.calories));
    const gap = ctx.calorieGoal - mean;

    // More than ~25% under target, sustained, is a bigger deficit than any of
    // these plans ask for.
    if (gap > ctx.calorieGoal * 0.25) {
      const perWeek = (gap * 7) / KCAL_PER_KG;
      return {
        key: 'under-eating',
        title: 'Eating well under your target',
        because: `About ${round(mean).toLocaleString()} kcal a day against a target of ${ctx.calorieGoal.toLocaleString()} — roughly ${round(gap)} short.`,
        ifRepeated: `That is a deficit of about ${kg(perWeek)} a week, faster than your plan asks for. Deficits this size tend to show up as flat training sessions and lost strength before they show on the scale, because the body meets the shortfall wherever it can.`,
        action: ctx.trainedRecently
          ? 'Add a proper meal on the days you train — that is where the shortfall costs most.'
          : 'Add around 300–400 kcal a day and see whether the trend holds.',
      };
    }

    // ── consistently over ───────────────────────────────────────────────
    const over = -gap;
    if (over > 250) {
      const perWeek = (over * 7) / KCAL_PER_KG;
      return {
        key: 'over-target',
        title: 'Running above your target',
        because: `About ${round(mean).toLocaleString()} kcal a day against ${ctx.calorieGoal.toLocaleString()} — roughly ${round(over)} over.`,
        ifRepeated: ctx.losingWeight
          ? `Kept up, that cancels most of the deficit your plan is built on: instead of losing, you would be roughly ${kg(perWeek)} a week the other way.`
          : `Kept up, that is about ${kg(perWeek)} a week gained.`,
        action: 'Look at the evenings first — that is where most surpluses actually come from.',
      };
    }
  }

  // ── protein ────────────────────────────────────────────────────────────
  if (ctx.proteinGoal) {
    const mean = avg(logged.map((d) => d.protein_g));
    const short = ctx.proteinGoal - mean;

    if (short > ctx.proteinGoal * 0.15) {
      return {
        key: 'protein-short',
        title: 'Protein has been short all week',
        because: `Averaging ${round(mean)} g against a target of ${round(ctx.proteinGoal)} g — about ${round(short)} g a day short.`,
        ifRepeated: ctx.losingWeight
          ? 'In a deficit, protein is most of what decides whether the weight you lose comes off as fat or as muscle. The scale moves either way; what it is made of is the part protein changes.'
          : 'Protein is the input muscle is built from, so a shortfall caps what the training can turn into.',
        action: ctx.trainedRecently
          ? `Add roughly ${round(short)} g on training days — a scoop of whey and a bowl of curd covers most of it.`
          : `Add roughly ${round(short)} g a day: eggs, dal, curd, paneer or whey all close it cheaply.`,
      };
    }
  }

  return null;
}
