import { api } from './client';
import { ProfileBasics } from '../types';

export function getProfile(): Promise<ProfileBasics | null> {
  return api<ProfileBasics>('/api/profile').catch(() => null);
}

export interface ProfileChanges {
  height_cm?: number;
  age?: number;
  gender?: 'male' | 'female';
  activity_level?: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
}

/**
 * Updates the body profile behind the calorie maths.
 *
 * These were only ever settable during onboarding, so anyone who mistyped
 * their height — or simply had a birthday — was stuck with the wrong BMR and
 * no way to correct it. The server has accepted these all along
 * (`PUT /api/profile`); nothing in the app called it.
 */
export function updateProfile(changes: ProfileChanges): Promise<{ success: true }> {
  return api('/api/profile', { method: 'PUT', body: changes });
}
