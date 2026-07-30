/**
 * Deliberate exercise that isn't walking.
 *
 * Steps are a decent proxy for a day's general movement, but they say nothing
 * about an hour of badminton or a gym session — days with real training and few
 * steps looked identical to sedentary ones. This turns "what did you do, and
 * for how long" into an energy figure the plan can use.
 *
 * MET values are the Compendium of Physical Activities' published figures,
 * rounded. Energy = MET × 3.5 × kg ÷ 200 per minute, the standard conversion.
 */

export interface ExerciseKind {
  key: string;
  label: string;
  /** Metabolic equivalent — multiples of resting energy. */
  met: number;
}

/**
 * A short list beats a searchable database here: the point is to log the
 * session in two taps, and the difference between "badminton" and "badminton,
 * doubles" is smaller than the error in guessing the duration.
 */
export const EXERCISE_KINDS: ExerciseKind[] = [
  { key: 'walk', label: 'Walk', met: 3.5 },
  { key: 'run', label: 'Run', met: 9.8 },
  { key: 'cycle', label: 'Cycling', met: 7.5 },
  { key: 'gym', label: 'Gym / weights', met: 5.0 },
  { key: 'cricket', label: 'Cricket', met: 4.8 },
  { key: 'football', label: 'Football', met: 8.0 },
  { key: 'badminton', label: 'Badminton', met: 5.5 },
  { key: 'tennis', label: 'Tennis', met: 7.3 },
  { key: 'swim', label: 'Swimming', met: 7.0 },
  { key: 'yoga', label: 'Yoga', met: 3.0 },
  { key: 'hiit', label: 'HIIT / circuits', met: 8.0 },
  { key: 'other', label: 'Other', met: 5.0 },
];

export function exerciseKind(key: string | null | undefined): ExerciseKind | null {
  return EXERCISE_KINDS.find((k) => k.key === key) ?? null;
}

/**
 * Energy burned, in kcal.
 *
 * This is gross energy, which includes the resting energy the body would have
 * spent anyway — the reason the plan must not simply add it on top of a TDEE
 * that already assumes a normal day. `netExerciseKcal` handles that.
 */
export function exerciseKcal(kindKey: string, minutes: number, weightKg: number): number {
  const kind = exerciseKind(kindKey);
  if (!kind || minutes <= 0 || weightKg <= 0) return 0;
  return Math.round(((kind.met * 3.5 * weightKg) / 200) * minutes);
}

/**
 * The part of a session that isn't already counted in maintenance.
 *
 * A TDEE built from an activity level assumes you move a normal amount; adding
 * a session's *gross* burn on top counts that baseline twice and is how these
 * apps end up telling people they have another 600 kcal to spend. Subtracting
 * one MET's worth (roughly resting) leaves the genuinely extra energy.
 */
export function netExerciseKcal(kindKey: string, minutes: number, weightKg: number): number {
  const kind = exerciseKind(kindKey);
  if (!kind || minutes <= 0 || weightKg <= 0) return 0;
  const net = Math.max(0, kind.met - 1);
  return Math.round(((net * 3.5 * weightKg) / 200) * minutes);
}

/** "45 min badminton" — for a log line or a notification. */
export function describeExercise(kindKey: string, minutes: number): string {
  const kind = exerciseKind(kindKey);
  if (!kind || minutes <= 0) return '';
  return `${minutes} min ${kind.label.toLowerCase()}`;
}
