import { describe, expect, it } from 'vitest';
import { baselineAt, dayOffset, smoothSeries, toTrendPoints } from './weightTrend';
import { WeighIn } from '@/types';

const weighIn = (recorded_date: string, weight_kg: number): WeighIn => ({ recorded_date, weight_kg });

describe('dayOffset', () => {
  it('counts whole days between two local dates', () => {
    expect(dayOffset('2026-07-17', '2026-07-24')).toBe(7);
    expect(dayOffset('2026-07-17', '2026-07-17')).toBe(0);
    expect(dayOffset('2026-07-17', '2026-07-16')).toBe(-1);
  });

  it('crosses months and years', () => {
    expect(dayOffset('2026-12-30', '2027-01-02')).toBe(3);
  });

  it('is unaffected by daylight saving shifts', () => {
    // A 23- or 25-hour day must still count as one day, or the chart's x-axis
    // would drift by a day twice a year.
    expect(dayOffset('2026-03-28', '2026-03-30')).toBe(2);
    expect(dayOffset('2026-10-24', '2026-10-26')).toBe(2);
  });
});

describe('toTrendPoints', () => {
  it('converts weigh-ins to offsets from the plan start', () => {
    const points = toTrendPoints([weighIn('2026-07-24', 70.1)], '2026-07-17');
    expect(points).toEqual([{ day: 7, kg: 70.1 }]);
  });

  it('sorts oldest first, whatever order they arrive in', () => {
    const points = toTrendPoints(
      [weighIn('2026-07-24', 70.1), weighIn('2026-07-18', 70.8), weighIn('2026-07-20', 70.5)],
      '2026-07-17'
    );
    expect(points.map((p) => p.day)).toEqual([1, 3, 7]);
  });

  it('drops readings from before the plan began', () => {
    // Plotting them at a negative offset would run off the left of the chart.
    const points = toTrendPoints([weighIn('2026-07-10', 72), weighIn('2026-07-18', 70.8)], '2026-07-17');
    expect(points).toEqual([{ day: 1, kg: 70.8 }]);
  });

  it('is empty when there is nothing to plot', () => {
    expect(toTrendPoints([], '2026-07-17')).toEqual([]);
  });
});

describe('smoothSeries', () => {
  it('leaves a single reading alone', () => {
    expect(smoothSeries([{ day: 0, kg: 70 }])).toEqual([{ day: 0, kg: 70 }]);
  });

  it('averages each point with the week before it', () => {
    const smoothed = smoothSeries([
      { day: 0, kg: 70 },
      { day: 1, kg: 71 },
      { day: 2, kg: 72 },
    ]);
    expect(smoothed.map((p) => p.kg)).toEqual([70, 70.5, 71]);
  });

  it('only looks backwards — the line never uses the future', () => {
    // The first point must be its own value, not the series mean, or the chart
    // would show today's weight influenced by weigh-ins that haven't happened.
    const smoothed = smoothSeries([
      { day: 0, kg: 60 },
      { day: 1, kg: 80 },
    ]);
    expect(smoothed[0]!.kg).toBe(60);
  });

  it('drops readings older than the window', () => {
    // Day 10 is 10 days after day 0, outside the 7-day window, so it averages
    // only with day 8.
    const smoothed = smoothSeries([
      { day: 0, kg: 60 },
      { day: 8, kg: 70 },
      { day: 10, kg: 72 },
    ]);
    expect(smoothed[2]!.kg).toBe(71);
  });

  it('flattens a one-day spike instead of following it', () => {
    const daily = Array.from({ length: 7 }, (_, day) => ({ day, kg: 70 }));
    daily[6] = { day: 6, kg: 71 }; // one salty evening

    const smoothed = smoothSeries(daily);
    // The raw point moved a kilo; the trend moves a seventh of that.
    expect(smoothed[6]!.kg).toBeCloseTo(70.14, 2);
  });

  it('keeps the day offsets untouched', () => {
    const points = [
      { day: 0, kg: 70 },
      { day: 3, kg: 71 },
    ];
    expect(smoothSeries(points).map((p) => p.day)).toEqual([0, 3]);
  });
});

describe('baselineAt', () => {
  it('starts at the start weight and ends at the goal', () => {
    expect(baselineAt(70, 68, 56, 0)).toBe(70);
    expect(baselineAt(70, 68, 56, 56)).toBe(68);
  });

  it('interpolates linearly in between', () => {
    expect(baselineAt(70, 68, 56, 28)).toBe(69);
  });

  it('clamps outside the plan window', () => {
    // Past the target date the line holds at the goal rather than continuing
    // down forever.
    expect(baselineAt(70, 68, 56, 100)).toBe(68);
    expect(baselineAt(70, 68, 56, -10)).toBe(70);
  });

  it('handles a bulk, where the line rises', () => {
    expect(baselineAt(70, 74, 56, 28)).toBe(72);
  });

  it('returns the goal for a zero-length plan rather than dividing by zero', () => {
    expect(baselineAt(70, 68, 0, 0)).toBe(68);
  });
});
