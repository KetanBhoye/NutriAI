import { MealType } from '@/types';

/**
 * What each meal reminder says.
 *
 * Pure on purpose: this is the part users actually experience, and it has to
 * be right for four slots a day, every day, whether or not anything has been
 * logged. Scheduling lives next door in reminders.ts.
 *
 * The constraint that shapes everything here: a local notification's text is
 * fixed when it is *scheduled*, not when it fires. So only today's slots can
 * quote today's numbers — future days get copy that will still be true when it
 * arrives. See progress.md.
 */

export interface MealSlot {
  meal: MealType;
  hour: number;
  minute: number;
  /** Shown in the settings card so the schedule isn't a mystery. */
  label: string;
}

/**
 * When the nudges land. Late rather than early on purpose — a reminder that
 * arrives before you've eaten is a reminder to ignore.
 */
export const MEAL_SLOTS: MealSlot[] = [
  { meal: 'breakfast', hour: 11, minute: 0, label: '11:00 am' },
  { meal: 'lunch', hour: 14, minute: 0, label: '2:00 pm' },
  { meal: 'snack', hour: 18, minute: 0, label: '6:00 pm' },
  { meal: 'dinner', hour: 20, minute: 30, label: '8:30 pm' },
];

const MEAL_NAME: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  snack: 'Your snack',
  dinner: 'Dinner',
};

/** Generic, always-true encouragement per meal. Used for future days. */
const PROMPTS: Record<MealType, string[]> = {
  breakfast: [
    'Breakfast in yet? Protein this early makes the whole day easier.',
    "Log breakfast while you remember it. Twenty seconds, and today's on track.",
    'Start the day on the record. Breakfast counts more than you think.',
  ],
  lunch: [
    'Lunch logged? Half the day decided right here.',
    "Mid-day check-in. Get lunch in and you're still in control of today.",
    'Log lunch now — guessing at 9pm never goes well.',
  ],
  snack: [
    'Snack time. The honest ones are the ones that get logged.',
    'Evening snack? Log it and keep dinner easy.',
    "Small things add up — that's exactly why they're worth logging.",
  ],
  dinner: [
    "Dinner's the last piece. Close the day out properly.",
    'Log dinner and today is a complete day. Those are the ones that add up.',
    'Finish what you started — log dinner and call it done.',
  ],
};

/** Said when an earlier meal never made it in. Gentle, never scolding. */
const MISSED: string[] = [
  '%MEAL% never made it in. Add it now — the day still counts.',
  "Looks like %MEAL% didn't get logged. Catch it up while you remember.",
  '%MEAL% is missing from today. A rough guess beats a blank.',
];

export interface SlotContext {
  meal: MealType;
  /** Live data is only available — and only true — for today. */
  isToday: boolean;
  /** Meals already logged today. Ignored when `isToday` is false. */
  loggedMeals: MealType[];
  /** Calories still available today, if there's a goal. */
  remainingKcal: number | null;
  /** Protein still to go today, if there's a goal. */
  remainingProteinG: number | null;
  /** Rotates the wording so a week of reminders doesn't read identically. */
  seed: string;
}

function variant<T>(seed: string, options: T[]): T {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return options[hash % options.length]!;
}

/** The first meal of the day, before `meal`, that hasn't been logged. */
function firstMissed(meal: MealType, logged: MealType[]): MealType | null {
  const order = MEAL_SLOTS.map((s) => s.meal);
  const upTo = order.slice(0, order.indexOf(meal));
  return upTo.find((m) => !logged.includes(m)) ?? null;
}

export interface ReminderCopy {
  title: string;
  body: string;
}

/**
 * The notification for one slot, or **null when it shouldn't be sent at all**.
 *
 * Returning null matters: nagging someone to log a meal they already logged is
 * how notification permission gets revoked. If today's lunch is in, the 2pm
 * lunch nudge simply doesn't get scheduled.
 */
export function reminderCopy(ctx: SlotContext): ReminderCopy | null {
  const seed = `${ctx.seed}:${ctx.meal}`;

  // Future days: no live data, so nothing that could be stale on arrival.
  if (!ctx.isToday) {
    return { title: 'NutriAI', body: variant(seed, PROMPTS[ctx.meal]) };
  }

  // Already logged — say nothing.
  if (ctx.loggedMeals.includes(ctx.meal)) return null;

  const missed = firstMissed(ctx.meal, ctx.loggedMeals);
  if (missed) {
    return {
      title: `${MEAL_NAME[missed]} is still unlogged`,
      body: variant(seed, MISSED).replace('%MEAL%', MEAL_NAME[missed]),
    };
  }

  // On track: lead with what's left, because that's the actionable number.
  const prompt = variant(seed, PROMPTS[ctx.meal]);

  if (ctx.remainingKcal != null && ctx.remainingKcal > 0) {
    const protein =
      ctx.remainingProteinG != null && ctx.remainingProteinG > 0
        ? ` and ${Math.round(ctx.remainingProteinG)}g protein`
        : '';
    return {
      title: `${MEAL_NAME[ctx.meal]}?`,
      body: `${Math.round(ctx.remainingKcal)} kcal${protein} left today. ${prompt}`,
    };
  }

  // Over budget: don't cheerfully invite more food, and don't shame either.
  if (ctx.remainingKcal != null && ctx.remainingKcal <= 0) {
    return {
      title: `${MEAL_NAME[ctx.meal]}?`,
      body: "You're at your calories for today. Log it anyway — an honest day is worth more than a tidy one.",
    };
  }

  return { title: `${MEAL_NAME[ctx.meal]}?`, body: prompt };
}
