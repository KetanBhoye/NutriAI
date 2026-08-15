import { describe, expect, it } from 'vitest';
import { ApiError } from './api/client';
import { clearStoredUser, isSessionRejected, readStoredUser, writeStoredUser } from './session';
import type { User } from './auth';

const user: User = { id: 'u1', name: 'Manish', email: 'm@example.test', onboarded: true };

describe('isSessionRejected', () => {
  it('ends the session when the server says the cookie is no good', () => {
    expect(isSessionRejected(new ApiError(401, 'Unauthorized'))).toBe(true);
    expect(isSessionRejected(new ApiError(403, 'Forbidden'))).toBe(true);
  });

  it('keeps the session when the request never reached the server', () => {
    // This is the bug: status 0 is what client.ts throws for both a dead
    // connection and a timeout, and treating it as "signed out" logged people
    // out for opening the app on a train.
    expect(isSessionRejected(new ApiError(0, 'Network error — check your connection.'))).toBe(false);
    expect(isSessionRejected(new ApiError(0, 'Request timed out'))).toBe(false);
  });

  it('keeps the session when the server is up but broken', () => {
    expect(isSessionRejected(new ApiError(500, 'boom'))).toBe(false);
    expect(isSessionRejected(new ApiError(502, 'bad gateway'))).toBe(false);
    expect(isSessionRejected(new ApiError(404, 'not found'))).toBe(false);
  });

  it('keeps the session for anything that is not an API failure at all', () => {
    // A bug in our own code must not cost the user their login.
    expect(isSessionRejected(new TypeError('undefined is not a function'))).toBe(false);
    expect(isSessionRejected('401')).toBe(false);
    expect(isSessionRejected(null)).toBe(false);
  });
});

describe('the remembered profile', () => {
  it('round-trips, so an offline launch renders signed in', async () => {
    await writeStoredUser(user);
    expect(await readStoredUser()).toEqual(user);
  });

  it('is empty before anyone has signed in', async () => {
    expect(await readStoredUser()).toBeNull();
  });

  it('is gone after sign-out', async () => {
    await writeStoredUser(user);
    await clearStoredUser();
    expect(await readStoredUser()).toBeNull();
  });

  it('ignores a profile with no id, which could not drive the redirect anyway', async () => {
    await writeStoredUser({ id: '', name: '', email: '' });
    expect(await readStoredUser()).toBeNull();
  });
});
