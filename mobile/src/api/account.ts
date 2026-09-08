import { api } from './client';

export function deleteAccount(): Promise<{ ok: true }> {
  return api('/api/account', { method: 'DELETE' });
}

export function getAuthConfig(): Promise<{ googleClientId: string | null }> {
  return api<{ googleClientId: string | null }>('/api/auth/config').catch(() => ({ googleClientId: null }));
}

export function googleSignIn(credential: string): Promise<{ user: { id: string; name: string; email: string } }> {
  return api('/api/auth/google', { method: 'POST', body: { credential }, captureCookie: true });
}

/**
 * Sign in with Apple.
 *
 * `name` and `email` are sent alongside the token because Apple releases them
 * exactly once — on the very first authorization for this app — and never
 * again. The server verifies the token regardless and treats these two as
 * hints for creating the account, never as identity.
 */
export function appleSignIn(input: {
  identityToken: string;
  name?: string;
  email?: string;
}): Promise<{ user: { id: string; name: string; email: string } }> {
  return api('/api/auth/apple', { method: 'POST', body: input, captureCookie: true });
}
