import { api } from '../api';
import { HEALTH_SOURCE } from '../config';
import { health } from './index';
import { DailyHealth } from './types';

export interface SyncResult {
  reading: DailyHealth;
  posted: boolean;
  /** Metrics left out because the health store returned something impossible. */
  skipped: string[];
}

/**
 * The largest value each metric can honestly take in a single day. These match
 * the bounds `POST /api/activity` enforces.
 *
 * A reading past one of these isn't a big number, it's a broken one — Apple
 * Health has reported 4,980 "exercise minutes" for a day that contains only
 * 1,440, most likely from overlapping watch and phone samples being summed
 * twice. Clamping to the maximum would be worse than dropping it: 1,440 would
 * claim a full 24 hours of exercise, which is a fabrication rather than a
 * measurement.
 */
const MAX_PER_DAY: Record<string, number> = {
  steps: 200_000,
  active_energy_kcal: 20_000,
  distance_km: 500,
  exercise_minutes: 1440,
  weight_kg: 1000,
};

/**
 * Reads today's metrics from the platform health store and pushes them to
 * POST /api/activity (steps, active energy, distance, exercise minutes, and the
 * latest weight).
 *
 * Only fields that actually have a value are sent, so a sync never overwrites
 * good data with nulls — and only fields that are *plausible*, because the
 * endpoint validates the whole payload at once. One impossible number used to
 * take the entire sync down with it, losing the steps, energy, distance and
 * weight that were perfectly fine.
 */
export async function syncToday(): Promise<SyncResult> {
  const reading = await health.getDailyHealth(new Date());

  const candidates: Array<[string, number | null]> = [
    ['steps', reading.steps],
    ['active_energy_kcal', reading.activeEnergyKcal],
    ['distance_km', reading.distanceKm],
    ['exercise_minutes', reading.exerciseMinutes],
    ['weight_kg', reading.weightKg],
  ];

  const payload: Record<string, unknown> = {
    activity_date: reading.date,
    source: HEALTH_SOURCE,
  };
  const skipped: string[] = [];

  for (const [key, value] of candidates) {
    if (value == null) continue;
    if (!Number.isFinite(value) || value < 0 || value > MAX_PER_DAY[key]!) {
      skipped.push(key);
      console.warn(`Health sync: ignoring implausible ${key} (${value})`);
      continue;
    }
    payload[key] = value;
  }

  // Nothing worth sending (no metrics granted / available).
  const hasMetric = Object.keys(MAX_PER_DAY).some((k) => k in payload);
  if (!hasMetric) return { reading, posted: false, skipped };

  await api('/api/activity', { method: 'POST', body: payload });
  return { reading, posted: true, skipped };
}
