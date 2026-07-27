import { api } from './client';
import { ProfileBasics } from '../types';

export function getProfile(): Promise<ProfileBasics | null> {
  return api<ProfileBasics>('/api/profile').catch(() => null);
}
