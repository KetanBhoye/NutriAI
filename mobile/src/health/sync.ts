import { api } from '../api';
import { HEALTH_SOURCE } from '../config';
import { health } from './index';
import { DailyHealth } from './types';

export interface SyncResult {
  reading: DailyHealth;
  posted: boolean;
}

/**
 * Reads today's metrics from the platform health store and pushes them to
 * POST /api/activity (steps, active energy, distance, exercise minutes, and the
 * latest weight). Only sends fields that actually have a value so we never
 * overwrite good data with nulls.
 */
export async function syncToday(): Promise<SyncResult> {
  const reading = await health.getDailyHealth(new Date());

  const payload: Record<string, unknown> = {
    activity_date: reading.date,
    source: HEALTH_SOURCE,
  };
  if (reading.steps != null) payload.steps = reading.steps;
  if (reading.activeEnergyKcal != null) payload.active_energy_kcal = reading.activeEnergyKcal;
  if (reading.distanceKm != null) payload.distance_km = reading.distanceKm;
  if (reading.exerciseMinutes != null) payload.exercise_minutes = reading.exerciseMinutes;
  if (reading.weightKg != null) payload.weight_kg = reading.weightKg;

  // Nothing worth sending (no metrics granted / available).
  const hasMetric = ['steps', 'active_energy_kcal', 'distance_km', 'exercise_minutes', 'weight_kg'].some(
    (k) => k in payload
  );
  if (!hasMetric) return { reading, posted: false };

  await api('/api/activity', { method: 'POST', body: payload });
  return { reading, posted: true };
}
