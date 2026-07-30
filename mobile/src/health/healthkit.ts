import AppleHealthKit, {
  HealthInputOptions,
  HealthKitPermissions,
  HealthValue,
} from 'react-native-health';
import { DailyHealth, HealthProvider, dayBounds, toLocalDateString } from './types';

/**
 * iOS HealthKit provider (react-native-health). Reads are foreground-only;
 * everything is read-access, we never write.
 */

const PERMS: HealthKitPermissions = {
  permissions: {
    read: [
      AppleHealthKit.Constants.Permissions.StepCount,
      AppleHealthKit.Constants.Permissions.ActiveEnergyBurned,
      AppleHealthKit.Constants.Permissions.DistanceWalkingRunning,
      AppleHealthKit.Constants.Permissions.AppleExerciseTime,
      AppleHealthKit.Constants.Permissions.Weight,
    ],
    write: [],
  },
};

function init(): Promise<void> {
  return new Promise((resolve, reject) => {
    AppleHealthKit.initHealthKit(PERMS, (err: string) => {
      if (err) reject(new Error(err));
      else resolve();
    });
  });
}

function sumStat(
  fn: (opts: HealthInputOptions, cb: (err: string, r: HealthValue[]) => void) => void,
  opts: HealthInputOptions
): Promise<number | null> {
  return new Promise((resolve) => {
    fn(opts, (err, results) => {
      if (err || !Array.isArray(results)) return resolve(null);
      const total = results.reduce((acc, r) => acc + (r.value || 0), 0);
      resolve(results.length ? total : null);
    });
  });
}

export const healthKitProvider: HealthProvider = {
  name: 'Apple Health',

  async isAvailable() {
    return new Promise((resolve) => {
      AppleHealthKit.isAvailable((err: object, available: boolean) => {
        resolve(!err && available);
      });
    });
  },

  async requestPermissions() {
    await init();
    return true;
  },

  async getDailyHealth(date: Date): Promise<DailyHealth> {
    await init();
    const { start, end } = dayBounds(date);
    const range: HealthInputOptions = {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      ascending: true,
    };

    // Steps: use the aggregated daily total to avoid double-counting overlaps.
    const steps = await new Promise<number | null>((resolve) => {
      AppleHealthKit.getStepCount(
        { date: start.toISOString() } as HealthInputOptions,
        (err, r: HealthValue) => resolve(err ? null : Math.round(r?.value ?? 0) || null)
      );
    });

    const activeEnergyKcal = await sumStat(
      AppleHealthKit.getActiveEnergyBurned.bind(AppleHealthKit),
      range
    );
    const distanceMeters = await new Promise<number | null>((resolve) => {
      AppleHealthKit.getDistanceWalkingRunning(range, (err, r: HealthValue) =>
        resolve(err ? null : r?.value ?? null)
      );
    });
    // `unit` is not optional here, whatever the name suggests:
    // getAppleExerciseTime defaults to **seconds**
    // (RCTAppleHealthKit+Methods_Activity.m: `withDefault:[HKUnit secondUnit]`),
    // so without this a day of 83 minutes' exercise arrives as 4,980 and the
    // sync is rejected for exceeding the 1,440 minutes a day contains.
    // Energy and distance default to kilocalories and meters, which is what
    // the callers above already assume.
    const exerciseMinutes = await sumStat(
      AppleHealthKit.getAppleExerciseTime.bind(AppleHealthKit),
      { ...range, unit: 'minute' as HealthInputOptions['unit'] }
    );

    const weightKg = await new Promise<number | null>((resolve) => {
      AppleHealthKit.getLatestWeight(
        { unit: 'gram' } as HealthInputOptions,
        (err, r: HealthValue) => resolve(err || !r ? null : r.value / 1000)
      );
    });

    return {
      date: toLocalDateString(date),
      steps,
      activeEnergyKcal: activeEnergyKcal != null ? Math.round(activeEnergyKcal) : null,
      distanceKm: distanceMeters != null ? distanceMeters / 1000 : null,
      exerciseMinutes: exerciseMinutes != null ? Math.round(exerciseMinutes) : null,
      weightKg: weightKg != null ? Math.round(weightKg * 10) / 10 : null,
    };
  },
};
