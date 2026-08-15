import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError } from './api/client';
import type { User } from './auth';

/**
 * Session survival rules.
 *
 * Launching without a connection used to sign people out: the launch check
 * called `/api/me`, and *any* thrown error — including "no internet" — was
 * treated as "this session is dead", so the stored cookie was deleted and the
 * app bounced to /login. Losing your login because you walked into a lift is
 * the worst possible reading of a network failure, and it's unrecoverable:
 * once the cookie is gone, coming back online doesn't bring the session back.
 *
 * Only the server can tell us a session is over. A request that never reached
 * it tells us nothing.
 */

const USER_KEY = 'nutriai.auth.user';

/**
 * True only when the server itself rejected the session. Transport failures
 * (`ApiError` with status 0 — offline, DNS, timeout) and 5xx (the server is
 * up but broken) leave the session alone.
 */
export function isSessionRejected(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return error.status === 401 || error.status === 403;
}

/**
 * The last profile the server confirmed. Read at launch so an offline start
 * renders the app straight away instead of a login screen — the cookie is
 * still valid, we simply can't ask right now.
 */
export async function readStoredUser(): Promise<User | null> {
  try {
    const raw = await AsyncStorage.getItem(USER_KEY);
    if (!raw) return null;
    const user = JSON.parse(raw) as User;
    // A user with no id can't drive the redirect logic in AuthGate.
    return user && typeof user.id === 'string' && user.id ? user : null;
  } catch {
    return null;
  }
}

export async function writeStoredUser(user: User): Promise<void> {
  try {
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    // Never let a cache write break sign-in.
  }
}

export async function clearStoredUser(): Promise<void> {
  try {
    await AsyncStorage.removeItem(USER_KEY);
  } catch {
    // ignore
  }
}
