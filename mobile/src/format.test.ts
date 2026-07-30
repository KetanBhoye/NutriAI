import { describe, expect, it } from 'vitest';
import { capitalize } from './format';

describe('capitalize', () => {
  it('title-cases the meal names the API returns lowercase', () => {
    expect(capitalize('breakfast')).toBe('Breakfast');
    expect(capitalize('snack')).toBe('Snack');
  });

  it('leaves an already-capitalised word alone', () => {
    expect(capitalize('Lunch')).toBe('Lunch');
  });

  it('only touches the first character', () => {
    expect(capitalize('gym / weights')).toBe('Gym / weights');
  });

  it('survives an empty string', () => {
    expect(capitalize('')).toBe('');
  });
});
