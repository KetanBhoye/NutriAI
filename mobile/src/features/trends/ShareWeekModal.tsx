import { useRef, useState } from 'react';
import { Dimensions, Platform, StyleSheet, Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import { Button, Sheet } from '@/components/ui';
import { colors, space } from '@/theme';
import { DOWNLOAD_URL, SNAP_CLIENT_ID } from '@/config';
import type { Consistency } from '@/api/dashboard';
import { SNAPCHAT, shareImageTo, shareSnapSticker, shareSnapToPreview } from '@modules/share-to-app';
import { WeekShareCard } from './WeekShareCard';
import { WeekShareSticker } from './WeekShareSticker';
import { ShareModeToggle, type ShareMode } from '../share/ShareModeToggle';
import { weekShareCaption } from './weekShareCopy';

/**
 * Share sheet for the weekly card.
 *
 * Mechanics deliberately mirror the daily story modal rather than inventing a
 * second approach — same capture-at-story-resolution trick, same
 * expo-sharing (React Native's own Share drops the file on Android), same
 * Instagram fast path with a fallback. Two share flows that behave differently
 * is a bug report waiting to happen.
 */

/**
 * Sized from the *height* available in the sheet, not just the width.
 *
 * A 9:16 card 300pt wide is 533pt tall, which overflowed the sheet on a normal
 * phone: the brand mark and the "TOP N%" line were clipped behind the share
 * buttons. The exported PNG was fine — it is re-rendered at 1080×1920 — so this
 * only ever broke the preview, which is precisely the thing someone looks at
 * before deciding to post.
 */
const { width: WIN_W, height: WIN_H } = Dimensions.get('window');
const CARD_W = Math.min(WIN_W - 72, 300, Math.round(((WIN_H * 0.5) * 9) / 16));

/** What the exported image is, regardless of how small the preview is drawn. */
const STORY_W = 1080;
const STORY_H = 1920;

/**
 * The sticker is drawn at the size it will be *used*, not shrunk to fit.
 *
 * Unlike the card — which is previewed small and re-rendered at 1080×1920 — a
 * sticker is captured at its natural size, so the points here become the pixels
 * Snapchat receives. Too small and the type is soft on a big phone; too large
 * and it stops being a sticker.
 */
const STICKER_W = Math.min(WIN_W - 96, 280);

/**
 * How big Snapchat draws it, in dp, before the user drags or pinches it.
 *
 * About three quarters of a phone's width: wide enough to read at a glance in a
 * Story, narrow enough that the photo underneath is still the subject.
 */
const STICKER_DP = 260;

interface Props {
  visible: boolean;
  data: Consistency;
  stats: { streak: number; averageCalories: number };
  onClose: () => void;
}

export function ShareWeekModal({ visible, data, stats, onClose }: Props) {
  const shotRef = useRef<View>(null);
  // Targets that accept text get the link too; the card carries it visually
  // for the ones that do not (Instagram stories, screenshots).
  const caption = `${weekShareCaption(data)}\n${DOWNLOAD_URL}`;
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ShareMode>('card');

  /**
   * The on-screen card is ~300pt wide so it fits in a sheet. Capturing at that
   * size yields a 300px image that Instagram upscales to 1080 — soft, and it
   * looks cheap in a feed. width/height re-render into a bitmap of that size,
   * so the text is redrawn sharp rather than stretched.
   */
  const capture = () =>
    mode === 'sticker'
      ? /**
         * No width/height for a sticker, unlike the card.
         *
         * Forcing 1080×1920 would letterbox the sticker inside a 9:16 frame —
         * the transparent margins are invisible, so it would look right in the
         * preview and land in Snapchat as a small badge floating in a huge
         * empty box the user cannot resize. Captured at its natural size, the
         * PNG is the sticker and nothing else.
         */
        captureRef(shotRef, { format: 'png', quality: 1, result: 'tmpfile' })
      : captureRef(shotRef, {
          format: 'png',
          quality: 1,
          result: 'tmpfile',
          width: STORY_W,
          height: STORY_H,
        });

  const share = async () => {
    setSharing(true);
    setError(null);
    try {
      const uri = await capture();
      if (!(await Sharing.isAvailableAsync())) {
        setError('Sharing is not available on this device.');
        return;
      }
      await Sharing.shareAsync(uri, {
        mimeType: 'image/png',
        UTI: 'public.png',
        dialogTitle: 'Share your week',
      });
    } catch {
      setError("Couldn't share that card.");
    } finally {
      setSharing(false);
    }
  };

  /**
   * Snapchat, into the camera preview where a Snap is actually composed.
   *
   * Three routes, tried in order, because they degrade in quality rather than
   * in kind:
   *
   *   1. **Creative Kit preview** — the card opens in Snapchat's editor and can
   *      go to a Story. This is the only one that produces a *Snap*.
   *   2. **A plain send intent** — reaches Snapchat's "Send To" screen, where
   *      the card arrives as a chat attachment. Not what the button promises,
   *      but it does put the card in Snapchat.
   *   3. **The system share sheet** — iOS, and Android without Snapchat.
   *
   * Route 2 was the whole implementation until a real device showed what it
   * produces: a message with a picture on it, no Story option anywhere. It is
   * kept only as the rung below Creative Kit, which needs a client ID the build
   * may not have been given.
   *
   * Goes through the local `share-to-app` native module rather than
   * expo-intent-launcher, which cannot put a Parcelable Uri in EXTRA_STREAM —
   * with it, the intent failed every time and fell silently through to the
   * system chooser, so the button was only ever pretending to be direct.
   */
  const shareToSnapchat = async () => {
    setSharing(true);
    setError(null);
    try {
      const uri = await capture();
      // getContentUriAsync is Android-only — it throws on iOS, where Creative
      // Kit reads the file:// URL directly.
      const snapUri =
        Platform.OS === 'android' ? await FileSystem.getContentUriAsync(uri) : uri;

      const snapped =
        mode === 'sticker'
          ? await shareSnapSticker(snapUri, SNAP_CLIENT_ID, 'NutriAI', {
              widthDp: STICKER_DP,
              heightDp: Math.round(STICKER_DP * 1.05),
            })
          : await shareSnapToPreview(snapUri, SNAP_CLIENT_ID, 'NutriAI');
      if (snapped) return;
      // Rung two is Android-only; on iOS the sheet is the only thing below.
      const opened =
        Platform.OS === 'android' ? await shareImageTo(snapUri, SNAPCHAT) : false;
      if (!opened) await share();
    } catch {
      await share().catch(() => setError("Couldn't share that card."));
    } finally {
      setSharing(false);
    }
  };

  /**
   * Straight into the Instagram story composer, skipping the share sheet.
   * Android only — Instagram's documented ADD_TO_STORY intent. Any failure
   * falls back to the normal sheet rather than dead-ending; Instagram is in
   * there too.
   */
  const shareToInstagram = async () => {
    setSharing(true);
    setError(null);
    try {
      const uri = await capture();
      const contentUri = await FileSystem.getContentUriAsync(uri);
      await IntentLauncher.startActivityAsync('com.instagram.share.ADD_TO_STORY', {
        data: contentUri,
        type: 'image/png',
        // FLAG_GRANT_READ_URI_PERMISSION — without it Instagram gets a URI it
        // may not read and shows an empty composer.
        flags: 1,
      });
    } catch {
      await share().catch(() => setError("Couldn't share that card."));
    } finally {
      setSharing(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Share your week">
      <View style={styles.preview}>
        <View ref={shotRef} collapsable={false}>
          {mode === 'sticker' ? (
            <WeekShareSticker data={data} w={STICKER_W} />
          ) : (
            <WeekShareCard data={data} stats={stats} w={CARD_W} />
          )}
        </View>
      </View>

      <ShareModeToggle mode={mode} onChange={setMode} disabled={sharing} />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.actions}>
        {Platform.OS === 'android' ? (
          <Button
            title="Instagram story"
            onPress={shareToInstagram}
            disabled={sharing}
            style={styles.action}
          />
        ) : null}
        <Button
          title="Snapchat"
          variant={Platform.OS === 'android' ? 'ghost' : 'primary'}
          onPress={shareToSnapchat}
          disabled={sharing}
          style={styles.action}
        />
        <Button
          title={sharing ? 'Preparing…' : 'More…'}
          variant="ghost"
          onPress={share}
          disabled={sharing}
          style={styles.action}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  preview: { alignItems: 'center', paddingVertical: space.sm },
  actions: { marginTop: space.md, gap: space.sm },
  action: { width: '100%' },
  error: { color: colors.danger, textAlign: 'center', marginTop: space.sm },
});
