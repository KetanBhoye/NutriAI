import { captureRef } from 'react-native-view-shot';

/**
 * Capturing and sharing a card in a browser.
 *
 * Capture works: react-native-view-shot ships a web implementation that runs
 * html2canvas over the DOM node. What it cannot do is `result: 'tmpfile'` —
 * there is no filesystem to write to — so this asks for a data URI and every
 * caller downstream is written against that.
 *
 * Delivery is the Web Share API when the browser has it, which on a phone
 * opens the same OS sheet the native app does, Instagram and Snapchat
 * included. On a desktop browser (or one that can't share files) it falls
 * back to downloading the PNG, which is the honest equivalent: the user still
 * ends up holding the image.
 *
 * The direct Instagram and Snapchat buttons are hidden here rather than
 * reimplemented (`DIRECT_TARGETS_SUPPORTED` is false). Those are an Android
 * intent and Snap's Creative Kit — native SDKs with no web equivalent, and a
 * button that opened a website instead of the composer would be the same
 * "looked like it worked" failure the native sheet's comments warn about.
 */

export const DIRECT_TARGETS_SUPPORTED = false;

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

/** A PNG of `ref`, as a `data:` URI. */
export function captureCard(ref: Parameters<typeof captureRef>[0], options: CaptureOptions): Promise<string> {
  return captureRef(ref, {
    format: 'png',
    quality: 1,
    // The web implementation has no temp files; asking for one only logs a
    // warning and hands back this anyway.
    result: 'data-uri',
    ...options,
  });
}

export type DeliverResult = 'shared' | 'unavailable' | 'failed';

export async function deliverCard(uri: string): Promise<DeliverResult> {
  const file = await dataUriToFile(uri);

  // `canShare` with the actual files, not just a `navigator.share` check:
  // desktop Chrome has the API but refuses file payloads, and finding that
  // out from a rejected promise mid-share is too late to fall back cleanly.
  if (file && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Share your day' });
      return 'shared';
    } catch (e) {
      // The user dismissing the sheet throws AbortError. That is not a
      // failure and must not show an error — they chose not to share.
      if ((e as Error)?.name === 'AbortError') return 'shared';
      return 'failed';
    }
  }

  return downloadCard(uri) ? 'shared' : 'unavailable';
}

/** No content URIs on the web; the data URI is already self-contained. */
export async function contentUriFor(uri: string): Promise<string> {
  return uri;
}

async function dataUriToFile(uri: string): Promise<File | null> {
  try {
    // fetch() parses a data: URI for us rather than hand-decoding base64.
    const blob = await (await fetch(uri)).blob();
    return new File([blob], 'nutriai.png', { type: 'image/png' });
  } catch {
    return null;
  }
}

/**
 * Saving the card, for anything that can't share a file.
 *
 * A synthetic click on an `<a download>` is the only way a page can hand the
 * user a file it generated. The anchor never enters the layout — it is created,
 * clicked and removed within the one call.
 */
function downloadCard(uri: string): boolean {
  try {
    const link = document.createElement('a');
    link.href = uri;
    link.download = `nutriai-${new Date().toISOString().slice(0, 10)}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    return true;
  } catch {
    return false;
  }
}
