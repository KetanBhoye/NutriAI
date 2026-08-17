import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shareSnapSticker, shareSnapToPreview } from './index';

/**
 * The routing decisions in the share wrapper.
 *
 * The native code these guard is what actually talks to Snapchat and can only
 * be judged on a device. What can be pinned here is which route gets taken —
 * and that is where the bug was: the Snap button reached Snapchat's plain send
 * intent, which delivers the card as a *chat attachment* rather than a Snap.
 * Every test below is about not silently landing on a worse rung of that
 * ladder, because each one still "works" and so fails quietly.
 */

// vi.hoisted: vi.mock calls are lifted above everything else in the file, so a
// plain const here would not exist yet when the factory below runs.
const native = vi.hoisted(() => ({
  isAppInstalled: vi.fn(() => true),
  shareImage: vi.fn(async () => true),
  shareSnapToPreview: vi.fn(async () => true),
  // Typed with an args signature so assertions can read individual
  // arguments — vi.fn(async () => true) infers a zero-arity call tuple.
  shareSnapSticker: vi.fn(async (..._args: unknown[]) => true),
}));

const state = vi.hoisted(() => ({ platform: 'android' }));

vi.mock('expo', () => ({ requireOptionalNativeModule: () => native }));
vi.mock('react-native', () => ({
  get Platform() {
    return { OS: state.platform };
  },
}));

beforeEach(() => {
  state.platform = 'android';
  vi.clearAllMocks();
});

describe('sending a real Snap', () => {
  it('passes the client ID and app name through to the preview intent', async () => {
    // Snapchat identifies the calling app by the client ID alone. Drop it and
    // the deep link is ignored and the card silently becomes a chat message —
    // the exact regression this whole path exists to fix.

    await shareSnapToPreview('content://card.png', 'client-123', 'NutriAI', 'Held the line.');

    expect(native.shareSnapToPreview).toHaveBeenCalledWith(
      'content://card.png',
      'client-123',
      'NutriAI',
      'Held the line.'
    );
  });

  it('sends null rather than undefined when there is no caption', async () => {
    // Crosses the native bridge, where undefined and null are not
    // interchangeable: an undefined for a `String?` argument throws.

    await shareSnapToPreview('content://card.png', 'client-123', 'NutriAI');

    expect(native.shareSnapToPreview).toHaveBeenCalledWith(
      'content://card.png',
      'client-123',
      'NutriAI',
      null
    );
  });
});

describe('when a real Snap is not possible', () => {
  it('declines without a client ID instead of calling the native side', async () => {
    // A build with no Creative Kit ID must fall back to the send intent, not
    // fire an intent Snapchat will reject. Returning false is what tells the
    // caller to try the next rung.

    const sent = await shareSnapToPreview('content://card.png', '', 'NutriAI');

    expect(sent).toBe(false);
    expect(native.shareSnapToPreview).not.toHaveBeenCalled();
  });

  it('still goes native on iOS, where the SDK does the same job', async () => {
    // The one function in this module that is not Android-only. Android reaches
    // the preview with an Intent and iOS with Snap's SDK, but the caller should
    // not have to know which — a platform check here would silently drop iPhone
    // users back to the share sheet, which is the original bug.
    state.platform = 'ios';

    const sent = await shareSnapToPreview('file:///card.png', 'client-123', 'NutriAI');

    expect(sent).toBe(true);
    expect(native.shareSnapToPreview).toHaveBeenCalled();
  });

  it('reports failure rather than throwing when the intent cannot start', async () => {
    // Snapchat missing, too old, or the client ID rejected. The caller catches
    // nothing here — it branches on the boolean — so a throw would break the
    // fallback chain and leave the user with a button that does nothing.
    native.shareSnapToPreview.mockRejectedValueOnce(new Error('no activity found'));

    await expect(
      shareSnapToPreview('content://card.png', 'client-123', 'NutriAI')
    ).resolves.toBe(false);
  });
});

describe('sending a sticker instead of a card', () => {
  it('rounds the sizes, because the native side takes ints', async () => {
    // Captured dimensions are points and arrive fractional on a 2.75x screen.
    // Kotlin's Int parameters reject a Double outright, so an unrounded value
    // fails the whole share rather than being coerced.
    await shareSnapSticker('content://sticker.png', 'client-123', 'NutriAI', {
      widthDp: 260.4,
      heightDp: 273.19,
    });

    expect(native.shareSnapSticker).toHaveBeenCalledWith(
      'content://sticker.png',
      'client-123',
      'NutriAI',
      260,
      273,
      0.42
    );
  });

  it('defaults the sticker above centre rather than over the subject', async () => {
    // The middle of a hand-held food shot is the food. Covering it defeats the
    // point of a sticker, which is that the photo stays the post.
    await shareSnapSticker('content://sticker.png', 'client-123', 'NutriAI', {
      widthDp: 260,
      heightDp: 273,
    });

    const posY = native.shareSnapSticker.mock.calls[0]?.[5];
    expect(Number(posY)).toBeLessThan(0.5);
  });

  it('declines without a client ID, like the preview path', async () => {
    const sent = await shareSnapSticker('content://sticker.png', '', 'NutriAI', {
      widthDp: 260,
      heightDp: 273,
    });

    expect(sent).toBe(false);
    expect(native.shareSnapSticker).not.toHaveBeenCalled();
  });
});
