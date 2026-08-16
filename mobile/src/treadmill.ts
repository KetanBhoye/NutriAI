/**
 * Treadmill sessions: speed, incline and time into energy, distance and steps.
 *
 * The rest of the exercise list prices a session from a single MET value, which
 * cannot work here. A treadmill's whole point is that you set the grade, and
 * walking at 5 km/h on a 10% incline costs roughly twice what the same walk
 * costs on the flat — one MET number would call them identical.
 *
 * So this uses the ACSM metabolic equations, which take grade as an input:
 *
 *   walking   VO2 = 0.1·S + 1.8·S·G + 3.5
 *   running   VO2 = 0.2·S + 0.9·S·G + 3.5
 *
 * with VO2 in ml·kg⁻¹·min⁻¹, S the speed in m·min⁻¹, and G the grade as a
 * fraction. Energy follows from oxygen cost at ~5 kcal per litre of O₂.
 *
 * Everything here is an estimate and the errors are not small — stride length
 * in particular varies between people more than any formula admits. It is
 * still far better than the alternative, which was logging an hour of hill
 * walking as "walk" at a flat 3.5 MET.
 */

/** Resting oxygen uptake, and the definition of 1 MET. */
const RESTING_VO2 = 3.5;

/** kcal per litre of oxygen consumed. */
const KCAL_PER_LITRE_O2 = 5;

/**
 * Where the walking equation stops describing what the body is doing.
 *
 * ACSM's walking equation is validated to ~6.4 km/h and the running one from
 * ~8 km/h; in between, both are approximations. 7 km/h sits in that gap and is
 * near where most people stop walking and start jogging, so it's the least
 * wrong single threshold.
 */
const RUN_THRESHOLD_KMH = 7;

export interface TreadmillInput {
  speedKmh: number;
  /** Grade as a percentage, as the machine displays it. */
  inclinePct: number;
  minutes: number;
  weightKg: number;
  /** Used for stride length. Falls back to an average adult if unknown. */
  heightCm?: number | null;
}

const DEFAULT_HEIGHT_CM = 170;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const finite = (n: unknown, fallback = 0): number =>
  typeof n === 'number' && Number.isFinite(n) ? n : fallback;

/** Oxygen cost in ml·kg⁻¹·min⁻¹ for the given speed and grade. */
export function treadmillVo2(speedKmh: number, inclinePct: number): number {
  const speed = clamp(finite(speedKmh), 0, 30);
  // Grades above ~20% are outside anything the equations were fitted on, and
  // most machines stop there anyway.
  const grade = clamp(finite(inclinePct), 0, 20) / 100;
  const metresPerMin = (speed * 1000) / 60;

  if (speed <= 0) return RESTING_VO2;

  return speed < RUN_THRESHOLD_KMH
    ? 0.1 * metresPerMin + 1.8 * metresPerMin * grade + RESTING_VO2
    : 0.2 * metresPerMin + 0.9 * metresPerMin * grade + RESTING_VO2;
}

/**
 * Energy for the session.
 *
 * `net` is the figure to log: it is the cost **above resting**, because the
 * user's maintenance calories already assume they were alive and breathing for
 * that hour. Logging gross would count the resting portion twice, which is the
 * same reasoning as `netExerciseKcal` for the MET-based kinds.
 */
export function treadmillEnergy(input: TreadmillInput): { gross: number; net: number } {
  const minutes = clamp(finite(input.minutes), 0, 1440);
  const weight = clamp(finite(input.weightKg), 20, 400);
  if (minutes <= 0) return { gross: 0, net: 0 };

  const vo2 = treadmillVo2(input.speedKmh, input.inclinePct);
  const litresPerMin = (vo2 * weight) / 1000;
  const gross = litresPerMin * KCAL_PER_LITRE_O2 * minutes;

  const restingLitresPerMin = (RESTING_VO2 * weight) / 1000;
  const resting = restingLitresPerMin * KCAL_PER_LITRE_O2 * minutes;

  return { gross: Math.round(gross), net: Math.max(0, Math.round(gross - resting)) };
}

export function treadmillDistanceKm(speedKmh: number, minutes: number): number {
  const speed = clamp(finite(speedKmh), 0, 30);
  const mins = clamp(finite(minutes), 0, 1440);
  return (speed * mins) / 60;
}

/**
 * Step length as a fraction of height.
 *
 * Roughly 0.41 of height at a walk, rising with speed as the stride opens out.
 * Incline works the other way: at a fixed speed a climb is taken in shorter,
 * quicker steps, so the same distance costs *more* steps. Both effects are
 * modest and both are approximations — treat the step count as indicative.
 */
function stepLengthMetres(speedKmh: number, inclinePct: number, heightCm: number): number {
  const speed = clamp(finite(speedKmh), 0, 30);
  const grade = clamp(finite(inclinePct), 0, 20);

  const base =
    speed < RUN_THRESHOLD_KMH
      ? 0.41 + 0.015 * Math.max(0, speed - 3)
      : 0.47 + 0.02 * (speed - RUN_THRESHOLD_KMH);

  // ~0.8% shorter per 1% of grade, capped so a steep setting can't collapse it.
  const inclineFactor = clamp(1 - 0.008 * grade, 0.85, 1);

  return clamp(base, 0.35, 0.65) * (heightCm / 100) * inclineFactor;
}

/**
 * Steps for the session.
 *
 * Treadmill work is the case where a phone's own step count is least
 * trustworthy — the phone is usually on the machine's rack rather than in a
 * pocket, so an hour of walking can register as nothing at all. Deriving steps
 * from distance and stride is what lets the day reflect the work.
 */
export function treadmillSteps(input: TreadmillInput): number {
  const distanceKm = treadmillDistanceKm(input.speedKmh, input.minutes);
  if (distanceKm <= 0) return 0;

  const height = clamp(finite(input.heightCm, DEFAULT_HEIGHT_CM) || DEFAULT_HEIGHT_CM, 120, 230);
  const stride = stepLengthMetres(input.speedKmh, input.inclinePct, height);

  return Math.round((distanceKm * 1000) / stride);
}

/** Everything the log form needs, in one call. */
export function treadmillSummary(input: TreadmillInput): {
  kcal: number;
  steps: number;
  distanceKm: number;
} {
  return {
    kcal: treadmillEnergy(input).net,
    steps: treadmillSteps(input),
    distanceKm: Math.round(treadmillDistanceKm(input.speedKmh, input.minutes) * 100) / 100,
  };
}
