import { describe, expect, it } from 'vitest';
import {
  EXERCISE_KINDS,
  describeExercise,
  exerciseKcal,
  exerciseKind,
  netExerciseKcal,
} from './exercise';

describe('exerciseKcal', () => {
  it('uses the standard MET conversion', () => {
    // Badminton, MET 5.5, 70 kg, 60 min: 5.5 × 3.5 × 70 ÷ 200 × 60 ≈ 404.
    expect(exerciseKcal('badminton', 60, 70)).toBe(404);
  });

  it('scales with duration and body weight', () => {
    expect(exerciseKcal('run', 60, 70)).toBe(exerciseKcal('run', 30, 70) * 2);
    expect(exerciseKcal('run', 30, 90)).toBeGreaterThan(exerciseKcal('run', 30, 70));
  });

  it('ranks harder activities higher', () => {
    expect(exerciseKcal('run', 30, 70)).toBeGreaterThan(exerciseKcal('yoga', 30, 70));
  });

  it('is zero for nonsense input rather than NaN', () => {
    expect(exerciseKcal('badminton', 0, 70)).toBe(0);
    expect(exerciseKcal('badminton', -30, 70)).toBe(0);
    expect(exerciseKcal('badminton', 30, 0)).toBe(0);
    expect(exerciseKcal('quidditch', 30, 70)).toBe(0);
  });
});

describe('netExerciseKcal', () => {
  it('excludes the resting energy already inside maintenance', () => {
    // The plan's TDEE already assumes a normal day, so only the energy above
    // resting is genuinely extra.
    expect(netExerciseKcal('badminton', 60, 70)).toBeLessThan(exerciseKcal('badminton', 60, 70));
  });

  it('subtracts exactly one MET', () => {
    // Badminton 5.5 → 4.5 net: 4.5 × 3.5 × 70 ÷ 200 × 60 ≈ 331.
    expect(netExerciseKcal('badminton', 60, 70)).toBe(331);
  });

  it('never goes negative for very light activity', () => {
    expect(netExerciseKcal('yoga', 60, 70)).toBeGreaterThanOrEqual(0);
  });

  it('is zero for nonsense input', () => {
    expect(netExerciseKcal('other', 0, 70)).toBe(0);
    expect(netExerciseKcal('nope', 30, 70)).toBe(0);
  });
});

describe('EXERCISE_KINDS', () => {
  it('has unique keys', () => {
    const keys = EXERCISE_KINDS.map((k) => k.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has plausible MET values throughout', () => {
    for (const kind of EXERCISE_KINDS) {
      expect(kind.met).toBeGreaterThan(1);
      expect(kind.met).toBeLessThan(20);
    }
  });

  it('resolves a key back to its kind', () => {
    expect(exerciseKind('gym')?.label).toBe('Gym / weights');
    expect(exerciseKind('nope')).toBeNull();
    expect(exerciseKind(null)).toBeNull();
  });
});

describe('describeExercise', () => {
  it('reads as a log line', () => {
    expect(describeExercise('badminton', 45)).toBe('45 min badminton');
  });

  it('is empty when there is nothing to describe', () => {
    expect(describeExercise('badminton', 0)).toBe('');
    expect(describeExercise('nope', 45)).toBe('');
  });
});
