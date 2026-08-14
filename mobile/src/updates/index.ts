import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Application from 'expo-application';
import { api } from '../api';
import { formatSize, isUpdateAvailable } from './version';

/**
 * In-app updates for the Android build.
 *
 * NutriAI is handed out as an APK from /download rather than through the Play
 * Store, so nothing tells a phone that a new build exists — this does. The
 * server reports the newest published release (GET /api/app-version), the app
 * compares it to its own version, and if it's behind it offers to download and
 * install it. Same signing key, so it installs over the top and keeps all
 * local state.
 *
 * iOS is deliberately excluded, and not for want of trying: there is no
 * sanctioned way for a sideloaded iOS app to replace itself. iOS updates go
 * through TestFlight or the App Store.
 */

/** Whether this platform can install its own updates at all. */
export const UPDATES_SUPPORTED = Platform.OS === 'android';

export interface AppVersionResponse {
  version: string | null;
  notes: string;
  size_bytes: number | null;
  published_at: string | null;
  url: string;
}

export interface UpdateCheck {
  currentVersion: string;
  latestVersion: string | null;
  available: boolean;
  notes: string;
  /** e.g. "86 MB", or null when the server didn't say. */
  sizeLabel: string | null;
  /** Where to download it from. */
  url: string;
}

/**
 * The version this build reports to Android.
 *
 * `nativeApplicationVersion` first, because it's read from the installed
 * package itself — the exact `versionName` Android will compare against when
 * deciding whether to accept the update. `Constants.expoConfig` is the JS-side
 * copy of app.config.ts, which is right in practice but is a different source
 * of truth, and a null one in some build configurations. Being wrong here
 * means offering an update to someone who already has it, forever.
 */
export function currentVersion(): string {
  return Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '0.0.0';
}

/**
 * Asks the server what the newest build is.
 *
 * Throws only on a genuine network or server failure — "there is no release"
 * comes back as `available: false`, because it isn't an error and the user
 * shouldn't see one.
 */
export async function checkForUpdate(): Promise<UpdateCheck> {
  const res = await api<AppVersionResponse>('/api/app-version');
  const current = currentVersion();

  return {
    currentVersion: current,
    latestVersion: res.version,
    available: UPDATES_SUPPORTED && isUpdateAvailable(current, res.version),
    notes: res.notes ?? '',
    sizeLabel: formatSize(res.size_bytes),
    url: res.url,
  };
}

export { downloadApk, installApk, openInstallPermissionSettings, InstallError } from './installer';
export { compareVersions, formatSize, isUpdateAvailable } from './version';
