import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

/**
 * Hands a captured card straight to a named app (Snapchat, Instagram, …).
 *
 * `requireOptionalNativeModule` rather than the throwing variant: the module is
 * Android-only and is absent from the iOS binary, so importing it eagerly would
 * crash the app at startup on iPhone. Every function below degrades to "not
 * available" and the caller falls back to the system share sheet.
 */
const native = requireOptionalNativeModule<{
  isAppInstalled(packageName: string): boolean;
  shareImage(uri: string, packageName: string, mimeType: string): Promise<boolean>;
  shareSnapToPreview(
    uri: string,
    clientId: string,
    appName: string,
    caption: string | null
  ): Promise<boolean>;
}>('ShareToApp');

export const SNAPCHAT = 'com.snapchat.android';
export const INSTAGRAM = 'com.instagram.android';

/** False on iOS, and on Android when the app is missing or not declared in <queries>. */
export function isAppInstalled(packageName: string): boolean {
  if (Platform.OS !== 'android' || !native) return false;
  try {
    return native.isAppInstalled(packageName);
  } catch {
    return false;
  }
}

/**
 * Resolves true when the target app opened with the image attached.
 *
 * Returns false rather than throwing so the caller can fall back to the share
 * sheet in one branch — a share button that errors is worse than one that
 * takes an extra tap.
 */
export async function shareImageTo(
  uri: string,
  packageName: string,
  mimeType = 'image/png'
): Promise<boolean> {
  if (Platform.OS !== 'android' || !native) return false;
  try {
    return await native.shareImage(uri, packageName, mimeType);
  } catch {
    return false;
  }
}

/**
 * Opens the card in Snapchat's camera preview — a real Snap, not a chat message.
 *
 * The distinction is the whole point of this function. `shareImageTo` reaches
 * Snapchat's share receiver, which delivers the image as a chat attachment: a
 * message with a picture on it, that cannot go to a Story. Creative Kit reaches
 * the preview editor instead, where Story and Snapchat's creative tools are.
 *
 * Returns false when the build has no Creative Kit client ID, so callers keep a
 * working button either way: no ID means the old share path, not a dead button.
 * `SNAP_CLIENT_ID` is deliberately a parameter rather than an import — this
 * module is a thin wrapper over the native layer and should not reach into app
 * config.
 */
export async function shareSnapToPreview(
  uri: string,
  clientId: string,
  appName: string,
  caption?: string
): Promise<boolean> {
  if (Platform.OS !== 'android' || !native || !clientId) return false;
  try {
    return await native.shareSnapToPreview(uri, clientId, appName, caption ?? null);
  } catch {
    return false;
  }
}
