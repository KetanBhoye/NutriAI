import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { humanValidationError } from './validation.js';

/**
 * The bug this exists for: signing in with an empty form printed thirty lines
 * of Zod internals — `"code": "invalid_string"`, `"inclusive": true`, the lot —
 * onto the login screen, because the route passed `ZodError.message` straight
 * into the JSON body and the app renders that verbatim.
 */
const failure = (schema: z.ZodTypeAny, value: unknown) => {
  const result = schema.safeParse(value);
  if (result.success) throw new Error('expected the schema to reject this');
  return humanValidationError(result.error);
};

const login = z.object({ email: z.string().email(), password: z.string().min(1) });

describe('humanValidationError', () => {
  it('never leaks the validator internals a user saw on the sign-in screen', () => {
    const message = failure(login, { email: '', password: '' });

    for (const leak of ['code', 'invalid_string', 'path', 'inclusive', '{', '[']) {
      expect(message).not.toContain(leak);
    }
  });

  it('names the actual problem for a bad email', () => {
    expect(failure(login, { email: 'nope', password: 'x' })).toBe('Enter a valid email address.');
  });

  it('asks for a missing field rather than describing its type', () => {
    // "expected string, received undefined" helps nobody.
    expect(failure(login, { email: 'a@b.co' })).toBe('Enter your password.');
  });

  it('asks for an empty field rather than quoting a minimum of 1', () => {
    expect(failure(login, { email: 'a@b.co', password: '' })).toBe('Enter your password.');
  });

  it('quotes the minimum when it is a real requirement', () => {
    const schema = z.object({ password: z.string().min(8) });
    expect(failure(schema, { password: 'abc' })).toBe('Your password needs at least 8 characters.');
  });

  it('says which field, in words a person uses', () => {
    const schema = z.object({ goal_weight_kg: z.number() });
    expect(failure(schema, {})).toContain('goal weight');
  });

  it('falls back to the field name for anything unmapped', () => {
    const schema = z.object({ some_new_field: z.string() });
    expect(failure(schema, {})).toBe('Enter your some new field.');
  });

  it('reports one issue, not all of them', () => {
    // A wall of faults is not more helpful than the first one.
    const message = failure(login, { email: 'nope', password: '' });
    expect(message.split('.').filter(Boolean)).toHaveLength(1);
  });

  it('survives an error with no issues at all', () => {
    expect(humanValidationError({ issues: [] } as never)).toMatch(/not valid/i);
  });
});
