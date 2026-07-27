import {
  initialize,
  getSdkStatus,
  requestPermission,
  readRecords,
  aggregateRecord,
  SdkAvailabilityStatus,
} from 'react-native-health-connect';
import { DailyHealth, HealthProvider, dayBounds, toLocalDateString } from './types';

/**
 * Android Health Connect provider (react-native-health-connect). Read-only.
 * Aggregations use Health Connect's own aggregate API where available so we
 * mirror what Google Fit / the source apps report.
 */

const READ_PERMISSIONS = [
  { accessType: 'read', recordType: 'Steps' },
  { accessType: 'read', recordType: 'ActiveCaloriesBurned' },
  { accessType: 'read', recordType: 'Distance' },
  { accessType: 'read', recordType: 'ExerciseSession' },
  { accessType: 'read', recordType: 'Weight' },
] as const;

async function ensureInit(): Promise<void> {
  const ok = await initialize();
  if (!ok) throw new Error('Health Connect could not be initialised on this device.');
}

export const healthConnectProvider: HealthProvider = {
  name: 'Health Connect',

  async isAvailable() {
    try {
      const status = await getSdkStatus();
      return status === SdkAvailabilityStatus.SDK_AVAILABLE;
    } catch {
      return false;
    }
  },

  async requestPermissions() {
    await ensureInit();
    const granted = await requestPermission(READ_PERMISSIONS as any);
    return Array.isArray(granted) && granted.length > 0;
  },

  async getDailyHealth(date: Date): Promise<DailyHealth> {
    await ensureInit();
    const { start, end } = dayBounds(date);
    const timeRangeFilter = {
      operator: 'between' as const,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    };

    const steps = await safeAggregate('Steps', timeRangeFilter, (r: any) =>
      Math.round(r?.COUNT_TOTAL ?? 0)
    );
    const activeEnergyKcal = await safeAggregate(
      'ActiveCaloriesBurned',
      timeRangeFilter,
      (r: any) => Math.round(r?.ACTIVE_CALORIES_TOTAL?.inKilocalories ?? 0)
    );
    const distanceKm = await safeAggregate('Distance', timeRangeFilter, (r: any) => {
      const meters = r?.DISTANCE?.inMeters ?? 0;
      return meters ? meters / 1000 : null;
    });

    // Exercise minutes: sum session durations (no aggregate metric for this).
    const exerciseMinutes = await safeRead('ExerciseSession', timeRangeFilter, (records: any[]) => {
      if (!records.length) return null;
      const ms = records.reduce((acc, s) => {
        const from = new Date(s.startTime).getTime();
        const to = new Date(s.endTime).getTime();
        return acc + Math.max(0, to - from);
      }, 0);
      return Math.round(ms / 60000);
    });

    // Latest weight: widen the window to the last 90 days and take the newest.
    const weightWindow = {
      operator: 'between' as const,
      startTime: new Date(end.getTime() - 90 * 24 * 3600 * 1000).toISOString(),
      endTime: end.toISOString(),
    };
    const weightKg = await safeRead('Weight', weightWindow, (records: any[]) => {
      if (!records.length) return null;
      const latest = records[records.length - 1];
      const kg = latest?.weight?.inKilograms;
      return typeof kg === 'number' ? Math.round(kg * 10) / 10 : null;
    });

    return {
      date: toLocalDateString(date),
      steps: steps || null,
      activeEnergyKcal: activeEnergyKcal || null,
      distanceKm,
      exerciseMinutes,
      weightKg,
    };
  },
};

async function safeAggregate<T>(
  recordType: string,
  timeRangeFilter: any,
  map: (result: any) => T | null
): Promise<T | null> {
  try {
    const result = await aggregateRecord({ recordType: recordType as any, timeRangeFilter });
    return map(result);
  } catch {
    return null;
  }
}

async function safeRead<T>(
  recordType: string,
  timeRangeFilter: any,
  map: (records: any[]) => T | null
): Promise<T | null> {
  try {
    const { records } = await readRecords(recordType as any, { timeRangeFilter });
    return map(records ?? []);
  } catch {
    return null;
  }
}
