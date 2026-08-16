import { describe, expect, it } from 'vitest';
import {
  treadmillDistanceKm,
  treadmillEnergy,
  treadmillSteps,
  treadmillSummary,
  treadmillVo2,
} from './treadmill';

const session = (over: Partial<Parameters<typeof treadmillEnergy>[0]> = {}) => ({
  speedKmh: 5,
  inclinePct: 0,
  minutes: 30,
  weightKg: 70,
  heightCm: 175,
  ...over,
});

describe('oxygen cost', () => {
  it('matches the ACSM walking equation', () => {
    // 5 km/h = 83.33 m/min. 0.1×83.33 + 0 + 3.5 = 11.83
    expect(treadmillVo2(5, 0)).toBeCloseTo(11.83, 1);
  });

  it('matches the ACSM running equation above the walk/run threshold', () => {
    // 10 km/h = 166.67 m/min. 0.2×166.67 + 0 + 3.5 = 36.83
    expect(treadmillVo2(10, 0)).toBeCloseTo(36.83, 1);
  });

  it('makes incline cost real energy, which is the whole reason for this module', () => {
    // A single MET value would price these two identically.
    expect(treadmillVo2(5, 10)).toBeGreaterThan(treadmillVo2(5, 0) * 1.9);
  });

  it('is resting when the belt is not moving', () => {
    expect(treadmillVo2(0, 5)).toBe(3.5);
  });
});

describe('energy', () => {
  it('prices a flat half-hour walk in a believable range', () => {
    // ~11.83 ml/kg/min × 70 kg → 0.828 L/min → 4.1 kcal/min → ~124 gross.
    const { gross, net } = treadmillEnergy(session());
    expect(gross).toBeGreaterThan(110);
    expect(gross).toBeLessThan(140);
    // Net strips the resting portion (~37 kcal over 30 min at 70 kg).
    expect(net).toBeGreaterThan(80);
    expect(net).toBeLessThan(gross);
  });

  it('logs net, not gross — maintenance already counts the resting half-hour', () => {
    const { gross, net } = treadmillEnergy(session());
    // 3.5 ml/kg/min × 70 kg × 30 min ≈ 37 kcal of simply existing.
    expect(gross - net).toBeGreaterThan(30);
    expect(gross - net).toBeLessThan(45);
  });

  it('charges more for the same walk uphill', () => {
    const flat = treadmillEnergy(session({ inclinePct: 0 })).net;
    const hill = treadmillEnergy(session({ inclinePct: 8 })).net;
    expect(hill).toBeGreaterThan(flat * 1.5);
  });

  it('scales with body weight', () => {
    const light = treadmillEnergy(session({ weightKg: 55 })).net;
    const heavy = treadmillEnergy(session({ weightKg: 95 })).net;
    expect(heavy).toBeGreaterThan(light);
  });

  it('is zero for a session with no time', () => {
    expect(treadmillEnergy(session({ minutes: 0 }))).toEqual({ gross: 0, net: 0 });
  });

  it('never returns a negative net figure', () => {
    expect(treadmillEnergy(session({ speedKmh: 0 })).net).toBe(0);
  });
});

describe('distance and steps', () => {
  it('computes distance from speed and time', () => {
    expect(treadmillDistanceKm(6, 30)).toBeCloseTo(3, 5);
  });

  it('gives a plausible step count for a 3 km walk', () => {
    // 175 cm walking: stride ~0.75 m, so 3 km ≈ 4,000 steps. Pedometers put a
    // brisk kilometre around 1,250–1,400 steps.
    const steps = treadmillSteps(session({ speedKmh: 6, minutes: 30 }));
    expect(steps).toBeGreaterThan(3300);
    expect(steps).toBeLessThan(4600);
  });

  it('takes fewer steps to run a kilometre than to walk one', () => {
    const walk = treadmillSteps(session({ speedKmh: 5, minutes: 12 })); // 1 km
    const run = treadmillSteps(session({ speedKmh: 10, minutes: 6 })); // 1 km
    expect(run).toBeLessThan(walk);
  });

  it('takes more steps uphill at the same speed, because the stride shortens', () => {
    const flat = treadmillSteps(session({ inclinePct: 0 }));
    const hill = treadmillSteps(session({ inclinePct: 10 }));
    expect(hill).toBeGreaterThan(flat);
  });

  it('scales with height, since stride comes from it', () => {
    const short = treadmillSteps(session({ heightCm: 150 }));
    const tall = treadmillSteps(session({ heightCm: 195 }));
    expect(short).toBeGreaterThan(tall);
  });

  it('falls back to an average adult when height is unknown', () => {
    // A missing profile height must not produce zero or NaN steps.
    expect(treadmillSteps(session({ heightCm: null }))).toBeGreaterThan(0);
    expect(treadmillSteps(session({ heightCm: undefined }))).toBeGreaterThan(0);
  });

  it('is zero when nothing happened', () => {
    expect(treadmillSteps(session({ minutes: 0 }))).toBe(0);
    expect(treadmillSteps(session({ speedKmh: 0 }))).toBe(0);
  });
});

describe('summary', () => {
  it('returns the three figures the log form shows', () => {
    const s = treadmillSummary(session({ speedKmh: 6, inclinePct: 5, minutes: 45 }));

    expect(s.distanceKm).toBeCloseTo(4.5, 1);
    expect(s.kcal).toBeGreaterThan(0);
    expect(s.steps).toBeGreaterThan(0);
  });

  it('survives garbage input rather than propagating NaN into the log', () => {
    const s = treadmillSummary({
      speedKmh: Number.NaN,
      inclinePct: Number.NaN,
      minutes: Number.NaN,
      weightKg: Number.NaN,
    });

    expect(Number.isFinite(s.kcal)).toBe(true);
    expect(Number.isFinite(s.steps)).toBe(true);
    expect(Number.isFinite(s.distanceKm)).toBe(true);
  });
});
