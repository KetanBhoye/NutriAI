import { Platform } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';

/**
 * Turning a card on screen into something the user can post.
 *
 * Two steps that both differ by platform, kept behind one seam so the share
 * sheets themselves stay a single implementation:
 *
 *  - **capture**: a PNG of a view. Native rasterises to a temp file; the web
 *    build has only a data URI (see delivery.web.ts).
 *  - **deliver**: hand that PNG to whatever the platform's share is.
 *
 * The direct Instagram and Snapchat routes stay in the sheet rather than
 * moving here: they are Android intents and Creative Kit calls with no web
 * analogue at all, so they are hidden on web via `DIRECT_TARGETS_SUPPORTED`
 * rather than pretended at.
 */

/** Whether the app-specific share buttons (Instagram, Snapchat) can work. */
export const DIRECT_TARGETS_SUPPORTED = Platform.OS !== 'web';

export interface CaptureOptions {
  /**
   * Both or neither. Omitted means "capture at natural size", which is what
   * a sticker wants: forcing it into a 9:16 frame letterboxes it inside
   * invisible transparent margins, so it looks right in the preview and
   * arrives as a small badge floating in a box the user cannot resize.
   */
  width?: number;
  height?: number;
}

/** A PNG of `ref`, as a file:// URI. */
export function captureCard(ref: Parameters<typeof captureRef>[0], options: CaptureOptions): Promise<string> {
  return captureRef(ref, {
    format: 'png',
    quality: 1,
    result: 'tmpfile',
    ...options,
  });
}

export type DeliverResult = 'shared' | 'unavailable' | 'failed';

/**
 * The system share sheet.
 *
 * NOT React Native's Share: on Android it ignores `url` entirely and supports
 * only `message`, so the intent went out carrying nothing and WhatsApp
 * reported "can't share empty file". expo-sharing attaches the actual file,
 * through a FileProvider, on both platforms.
 */
export async function deliverCard(uri: string): Promise<DeliverResult> {
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  await Sharing.shareAsync(uri, {
    mimeType: 'image/png',
    UTI: 'public.png',
    dialogTitle: 'Share your day',
  });
  return 'shared';
}

/** An Android content:// URI another app is allowed to read. iOS uses the path. */
export async function contentUriFor(uri: string): Promise<string> {
  // getContentUriAsync is Android-only — it throws on iOS, where the
  // receiving SDK reads the file:// URL directly.
  return Platform.OS === 'android' ? await FileSystem.getContentUriAsync(uri) : uri;
}
