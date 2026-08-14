import * as FileSystem from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { describeDownloadProblem, describeSpaceProblem } from './verify';

/**
 * Downloading a new APK and handing it to Android's package installer.
 *
 * Android only, and only meaningful because NutriAI is distributed outside the
 * Play Store. Three things make this work:
 *
 *  1. `REQUEST_INSTALL_PACKAGES` in app.config.ts, plus the user allowing
 *     "install unknown apps" for NutriAI once, which Android prompts for
 *     itself the first time.
 *  2. A `content://` URI. Since Android 7, handing a `file://` path to another
 *     app throws FileUriExposedException; expo-file-system ships a
 *     FileProvider and `getContentUriAsync` produces the grantable URI.
 *  3. The same signing key as the installed build. `release.sh` verifies this
 *     before publishing — a mismatch here would fail with "App not installed"
 *     and could only be resolved by uninstalling and losing local state.
 *
 * The install itself is not something this code completes. Firing the intent
 * hands control to the system installer, which asks the user to confirm; the
 * app is then replaced underneath us. There is no success callback to await.
 */

/** Where partial and finished downloads live. Cache, so Android can reclaim it. */
const downloadDir = `${FileSystem.cacheDirectory ?? ''}updates/`;

export class InstallError extends Error {}

/**
 * Removes previously downloaded APKs.
 *
 * ~86 MB each, and the only thing worse than an update that fails is one that
 * fills the phone up doing it. Called before each download rather than after,
 * so a crashed download still gets cleaned up eventually.
 */
async function clearOldDownloads(): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(downloadDir);
    if (info.exists) await FileSystem.deleteAsync(downloadDir, { idempotent: true });
  } catch {
    // A cache we can't clear is not a reason to block the update.
  }
  await FileSystem.makeDirectoryAsync(downloadDir, { intermediates: true });
}

/**
 * Downloads the APK at `url`, reporting progress as a 0–1 fraction.
 *
 * Returns the local file URI. Throws InstallError with something a person can
 * act on — this runs behind a button the user pressed, so every failure needs
 * a sentence, not a stack trace.
 */
export async function downloadApk(
  url: string,
  version: string,
  sizeBytes: number | null,
  onProgress?: (fraction: number) => void
): Promise<string> {
  if (Platform.OS !== 'android') {
    throw new InstallError('In-app updates are only available on Android.');
  }

  // Before the download, not after: running out of space surfaces only as
  // Android's "App not installed", by which point the data is already spent.
  const spaceProblem = describeSpaceProblem(sizeBytes, await FileSystem.getFreeDiskStorageAsync());
  if (spaceProblem) throw new InstallError(spaceProblem);

  await clearOldDownloads();
  const target = `${downloadDir}NutriAI-${version}.apk`;

  const resumable = FileSystem.createDownloadResumable(url, target, {}, (progress) => {
    const total = progress.totalBytesExpectedToWrite;
    // A server that doesn't send Content-Length reports -1 here; a fraction of
    // a negative total would run the progress bar backwards.
    if (total > 0) onProgress?.(Math.min(1, progress.totalBytesWritten / total));
  });

  let result: FileSystem.FileSystemDownloadResult | undefined;
  try {
    result = await resumable.downloadAsync();
  } catch (e) {
    throw new InstallError(`The download failed: ${(e as Error).message}`);
  }
  if (!result) throw new InstallError('The download was interrupted.');

  const info = await FileSystem.getInfoAsync(result.uri, { size: true });
  const headBase64 = await FileSystem.readAsStringAsync(result.uri, {
    encoding: FileSystem.EncodingType.Base64,
    position: 0,
    length: 8,
  });

  const problem = describeDownloadProblem({
    status: result.status,
    size: info.exists ? (info.size ?? 0) : 0,
    headBase64,
  });
  if (problem) {
    await FileSystem.deleteAsync(result.uri, { idempotent: true });
    throw new InstallError(problem);
  }

  return result.uri;
}

/**
 * Hands the downloaded APK to the system installer.
 *
 * Resolves as soon as the installer is showing — not when the install
 * finishes. If the user confirms, this process is killed and replaced by the
 * new build, so there is nothing to run afterwards.
 */
export async function installApk(fileUri: string): Promise<void> {
  if (Platform.OS !== 'android') {
    throw new InstallError('In-app updates are only available on Android.');
  }

  const contentUri = await FileSystem.getContentUriAsync(fileUri);

  try {
    await IntentLauncher.startActivityAsync('android.intent.action.INSTALL_PACKAGE', {
      data: contentUri,
      // FLAG_GRANT_READ_URI_PERMISSION. Without it the installer receives a URI
      // it is not allowed to read, and fails as though the file were corrupt.
      flags: 1,
    });
  } catch (e) {
    throw new InstallError(
      `Android wouldn't open the installer: ${(e as Error).message}. ` +
        'Allow NutriAI to install unknown apps in Settings, then try again.'
    );
  }
}

/**
 * Opens the system screen where "install unknown apps" is granted for NutriAI.
 *
 * Android usually offers this itself when the install is blocked, but not
 * always — and a user who declined once has no obvious way back. This screen
 * is several levels deep in Settings and effectively unfindable by description.
 */
export async function openInstallPermissionSettings(): Promise<void> {
  const packageName = Application.applicationId ?? 'app.nutriai.mobile';
  await IntentLauncher.startActivityAsync('android.settings.MANAGE_UNKNOWN_APP_SOURCES', {
    data: `package:${packageName}`,
  });
}
