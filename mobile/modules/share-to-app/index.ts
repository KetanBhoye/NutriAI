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
