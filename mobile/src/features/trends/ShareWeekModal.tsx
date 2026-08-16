import { useRef, useState } from 'react';
import { Dimensions, Platform, StyleSheet, Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import { Button, Sheet } from '@/components/ui';
import { colors, space } from '@/theme';
import type { Consistency } from '@/api/dashboard';
import { WeekShareCard } from './WeekShareCard';

/**
 * Share sheet for the weekly card.
 *
 * Mechanics deliberately mirror the daily story modal rather than inventing a
 * second approach — same capture-at-story-resolution trick, same
 * expo-sharing (React Native's own Share drops the file on Android), same
 * Instagram fast path with a fallback. Two share flows that behave differently
 * is a bug report waiting to happen.
 */

const CARD_W = Math.min(Dimensions.get('window').width - 72, 300);

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
          title={sharing ? 'Preparing…' : 'Share'}
          variant={Platform.OS === 'android' ? 'ghost' : 'primary'}
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
