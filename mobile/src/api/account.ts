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
