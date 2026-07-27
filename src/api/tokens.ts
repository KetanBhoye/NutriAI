import { api } from './client';

export function getTokenStatus(): Promise<{ has_token: boolean }> {
  return api('/api/tokens/status');
}

export function rotateToken(): Promise<{ token: string; message: string }> {
  return api('/api/tokens/rotate', { method: 'POST' });
}

export function revokeToken(): Promise<{ ok: true; message: string }> {
  return api('/api/tokens/revoke', { method: 'POST' });
}
