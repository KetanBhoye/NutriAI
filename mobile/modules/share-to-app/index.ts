import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

/**
 * Hands a captured card straight to a named app (Snapchat, Instagram, …).
 *
 * `requireOptionalNativeModule` rather than the throwing variant: a JS-only
 * context (tests, or a build where the module failed to link) would otherwise
 * crash at import time. Every function below degrades to "not available" and
 * the caller falls back to the system share sheet.
 *
 * The direct-send functions are Android-only — iOS has no way to hand content
 * to a named app. `shareSnapToPreview` is the exception and works on both, via
 * an Intent on Android and Snap's Creative Kit SDK on iOS.
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
  shareSnapSticker(
    uri: string,
    clientId: string,
    appName: string,
    widthDp: number,
    heightDp: number,
    posY: number
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
  // Both platforms, unlike everything else in this module: Android reaches the
  // preview with an Intent, iOS with Snap's SDK, and the caller should not have
  // to know which.
  if (!native || !clientId) return false;
  try {
    return await native.shareSnapToPreview(uri, clientId, appName, caption ?? null);
  } catch {
    return false;
  }
}

/**
 * Opens Snapchat's camera with the card riding as a sticker on top.
 *
 * The counterpart to `shareSnapToPreview`, and a different product rather than
 * a different code path. There, our card *is* the Snap: the background is ours,
 * and the user's only decision is whether to send it. Here the background is
 * theirs — their meal, their gym, whatever they point the camera at — and our
 * design is a label on it.
 *
 * Which matters because of how the two get received. A full-frame card on
 * someone's Story is recognisably an app's output, and it is skipped. The same
 * numbers over a photo they took is their post, and it gets watched.
 *
 * `widthDp`/`heightDp` size the sticker inside Snapchat, and `posY` places it
 * vertically as a 0–1 fraction. They are passed rather than fixed because only
 * the caller knows the shape it just captured.
 */
export async function shareSnapSticker(
  uri: string,
  clientId: string,
  appName: string,
  size: { widthDp: number; heightDp: number; posY?: number }
): Promise<boolean> {
  if (!native || !clientId) return false;
  try {
    return await native.shareSnapSticker(
      uri,
      clientId,
      appName,
      Math.round(size.widthDp),
      Math.round(size.heightDp),
      // Slightly above centre: the middle of a hand-held food shot is usually
      // the food, and covering that defeats the point of a sticker.
      size.posY ?? 0.42
    );
  } catch {
    return false;
  }
}
