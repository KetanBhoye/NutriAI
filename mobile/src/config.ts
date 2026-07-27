import Constants from 'expo-constants';

/**
 * Backend base URL. Set at build time via the API_URL env var (see
 * app.config.ts); defaults to production. No trailing slash.
 */
export const API_URL: string = (
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  'https://nutriai-app.up.railway.app'
).replace(/\/$/, '');

/**
 * The `source` value POST /api/activity accepts. The backend enum is currently
 * `'apple_health' | 'manual'`, so Health Connect data is also tagged
 * `apple_health` (i.e. "synced from a health app"). If the backend later adds a
 * `'health_connect'` value, switch the Android branch in health/sync.ts.
 */
export const HEALTH_SOURCE = 'apple_health' as const;

/** iOS OAuth client ID for Google Sign-In (see app.config.ts). */
export const GOOGLE_IOS_CLIENT_ID: string | undefined = Constants.expoConfig?.extra?.googleIosClientId as
  | string
  | undefined;
