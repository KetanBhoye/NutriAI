import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyHealth } from './types';
// Static import: the `vi.mock` calls below are hoisted above it.
import { syncToday } from './sync';

/**
 * The sync's whole job is deciding *what to send*. Sending a null would
 * overwrite good data on the server, and sending nothing at all would waste a
 * request every 15 minutes on a device that granted no permissions.
 */

const apiCall = vi.fn();
const getDailyHealth = vi.fn();

vi.mock('../api', () => ({ api: (...args: unknown[]) => apiCall(...args) }));
vi.mock('./index', () => ({ health: { getDailyHealth: (d: Date) => getDailyHealth(d) } }));

const reading = (over: Partial<DailyHealth> = {}): DailyHealth => ({
  date: '2026-07-17',
  steps: null,
  activeEnergyKcal: null,
  exerciseMinutes: null,
  distanceKm: null,
  weightKg: null,
  ...over,
});

const bodyOf = (call: unknown[]) => (call[1] as { body: Record<string, unknown> }).body;

beforeEach(() => {
  vi.clearAllMocks();
  apiCall.mockResolvedValue({ ok: true });
});

describe('syncToday', () => {
  it('posts the metrics that have values', async () => {
    getDailyHealth.mockResolvedValue(reading({ steps: 8200, weightKg: 69.4 }));

    const result = await syncToday();

    expect(result.posted).toBe(true);
    expect(apiCall).toHaveBeenCalledTimes(1);
    expect(bodyOf(apiCall.mock.calls[0]!)).toMatchObject({
      activity_date: '2026-07-17',
      steps: 8200,
      weight_kg: 69.4,
    });
  });

  it('omits metrics that are null rather than sending them', async () => {
    // `POST /api/activity` upserts per day: a null would blank a value another
    // source had already recorded.
    getDailyHealth.mockResolvedValue(reading({ steps: 8200 }));

    await syncToday();

    const body = bodyOf(apiCall.mock.calls[0]!);
    expect('weight_kg' in body).toBe(false);
    expect('distance_km' in body).toBe(false);
    expect('exercise_minutes' in body).toBe(false);
  });

  it('sends nothing when no metric came back at all', async () => {
    // Permissions refused, or a device with no health data — don't spend a
    // request on an empty payload.
    getDailyHealth.mockResolvedValue(reading());

    const result = await syncToday();

    expect(result.posted).toBe(false);
    expect(apiCall).not.toHaveBeenCalled();
  });

  it('counts a weight-only reading as worth sending', async () => {
    getDailyHealth.mockResolvedValue(reading({ weightKg: 69.4 }));
    expect((await syncToday()).posted).toBe(true);
  });

  it('sends zero steps, which is a real measurement', async () => {
    // A day with 0 steps is information; it must not be mistaken for "unknown".
    getDailyHealth.mockResolvedValue(reading({ steps: 0 }));

    const result = await syncToday();

    expect(result.posted).toBe(true);
    expect(bodyOf(apiCall.mock.calls[0]!).steps).toBe(0);
  });

  it('tags the source so the server knows it came from a health app', async () => {
    getDailyHealth.mockResolvedValue(reading({ steps: 100 }));
    await syncToday();
    expect(bodyOf(apiCall.mock.calls[0]!).source).toBe('apple_health');
  });

  it('posts to the activity endpoint', async () => {
    getDailyHealth.mockResolvedValue(reading({ steps: 100 }));
    await syncToday();
    expect(apiCall.mock.calls[0]![0]).toBe('/api/activity');
    expect((apiCall.mock.calls[0]![1] as { method: string }).method).toBe('POST');
  });

  it('returns the reading either way, so the UI can show what it found', async () => {
    getDailyHealth.mockResolvedValue(reading({ steps: 8200 }));
    expect((await syncToday()).reading.steps).toBe(8200);
  });

  it('drops an impossible reading instead of failing the whole sync', async () => {
    // Seen in the wild: Apple Health reported 4,980 exercise minutes for a day
    // that contains 1,440. The endpoint validates the payload as a unit, so
    // this used to take the steps, energy, distance and weight down with it.
    getDailyHealth.mockResolvedValue(reading({ steps: 4142, exerciseMinutes: 4980, weightKg: 70.2 }));

    const result = await syncToday();

    expect(result.posted).toBe(true);
    expect(result.skipped).toEqual(['exercise_minutes']);
    const body = bodyOf(apiCall.mock.calls[0]!);
    expect(body).toMatchObject({ steps: 4142, weight_kg: 70.2 });
    expect('exercise_minutes' in body).toBe(false);
  });

  it('does not clamp an impossible value to the maximum', async () => {
    // 1,440 would claim a full 24 hours of exercise — a fabrication, not a
    // measurement. Better to have no figure than a made-up one.
    getDailyHealth.mockResolvedValue(reading({ steps: 100, exerciseMinutes: 4980 }));

    await syncToday();

    expect(bodyOf(apiCall.mock.calls[0]!).exercise_minutes).toBeUndefined();
  });

  it('keeps a value that sits exactly on the limit', async () => {
    // 1440 is a real, if absurd, day. The boundary belongs to the good side.
    getDailyHealth.mockResolvedValue(reading({ exerciseMinutes: 1440 }));

    await syncToday();

    expect(bodyOf(apiCall.mock.calls[0]!).exercise_minutes).toBe(1440);
  });

  it('rejects negatives and NaN, which no metric can be', async () => {
    getDailyHealth.mockResolvedValue(reading({ steps: -5, activeEnergyKcal: Number.NaN, distanceKm: 3.05 }));

    const result = await syncToday();

    expect(result.skipped).toEqual(['steps', 'active_energy_kcal']);
    expect(bodyOf(apiCall.mock.calls[0]!)).toMatchObject({ distance_km: 3.05 });
  });

  it('sends nothing when every reading is implausible', async () => {
    getDailyHealth.mockResolvedValue(reading({ steps: 999_999, exerciseMinutes: 4980 }));

    const result = await syncToday();

    expect(result.posted).toBe(false);
    expect(apiCall).not.toHaveBeenCalled();
    expect(result.skipped).toEqual(['steps', 'exercise_minutes']);
  });

  it('lets a failed request surface rather than reporting success', async () => {
    getDailyHealth.mockResolvedValue(reading({ steps: 8200 }));
    apiCall.mockRejectedValue(new Error('offline'));

    await expect(syncToday()).rejects.toThrow('offline');
  });
});
