import { useRef, useState } from 'react';
import { Dimensions, Platform, StyleSheet, Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import { Button, Sheet } from '@/components/ui';
import { colors, space } from '@/theme';
import { DOWNLOAD_URL } from '@/config';
import type { Consistency } from '@/api/dashboard';
import { WeekShareCard } from './WeekShareCard';
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

  /**
   * The on-screen card is ~300pt wide so it fits in a sheet. Capturing at that
   * size yields a 300px image that Instagram upscales to 1080 — soft, and it
   * looks cheap in a feed. width/height re-render into a bitmap of that size,
   * so the text is redrawn sharp rather than stretched.
   */
  const capture = () =>
    captureRef(shotRef, {
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
   * Snapchat.
   *
   * Android gets a targeted ACTION_SEND, which drops straight into Snapchat's
   * send screen. iOS cannot do this: handing an image to a *named* app needs
   * Snap's Creative Kit SDK and an app registered for a Client ID, and without
   * that the sandbox offers no route — so iOS falls through to the share
   * sheet, where Snapchat appears anyway. That is one extra tap, not a
   * dead end.
   *
   * Best-effort even on Android: Snapchat has no documented public intent
   * contract, so a version that stops accepting this must land the user in the
   * normal sheet rather than on an error.
   */
  const shareToSnapchat = async () => {
    if (Platform.OS !== 'android') {
      await share();
      return;
    }
    setSharing(true);
    setError(null);
    try {
      const uri = await capture();
      const contentUri = await FileSystem.getContentUriAsync(uri);
      await IntentLauncher.startActivityAsync('android.intent.action.SEND', {
        type: 'image/png',
        packageName: 'com.snapchat.android',
        // FLAG_GRANT_READ_URI_PERMISSION, or Snapchat gets a URI it may not read.
        flags: 1,
        extra: {
          'android.intent.extra.STREAM': contentUri,
          'android.intent.extra.TEXT': caption,
        },
      });
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
          <WeekShareCard data={data} stats={stats} w={CARD_W} />
        </View>
      </View>

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
