import { useEffect, useRef, useState } from 'react';
import { Dimensions, Platform, StyleSheet, Text, View } from 'react-native';
import ViewShot, { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import { dashboardApi } from '@/api';
import { ShareStats } from '@/api/dashboard';
import { Button, Loading, Sheet } from '@/components/ui';
import { colors, fonts, type } from '@/theme';
import { formatCardDate, pickCaption } from './shareCaption';
import { shareSnapSticker, shareSnapToPreview } from '@modules/share-to-app';
import { SNAP_CLIENT_ID } from '@/config';
import { ShareCardBackground } from './ShareCardBackground';
import { DayShareSticker } from './DayShareSticker';
import { ShareModeToggle, type ShareMode } from '../share/ShareModeToggle';

interface ShareStoryModalProps {
  visible: boolean;
  date: string;
  onClose: () => void;
}

/**
 * 9:16 so it drops straight into an Instagram/WhatsApp story without cropping.
 *
 * Sized from the height available in the sheet as well as the width: adding a
 * third share button pushed the last one off the bottom of the screen, because
 * a 300pt-wide 9:16 card is 533pt tall and left nothing for the buttons.
 */
const { width: WIN_W, height: WIN_H } = Dimensions.get('window');
const CARD_W = Math.min(WIN_W - 72, 300, Math.round(((WIN_H * 0.46) * 9) / 16));
const CARD_H = Math.round((CARD_W * 16) / 9);

/**
 * Everything inside the card is expressed against the 300pt width it was
 * drawn at. The type used to be fixed pixels, so the moment the card had to
 * shrink to make room for a third button the sub-line wrapped, the KCAL row
 * wrapped, and the footer was pushed clean out of the frame. Scaling keeps the
 * composition identical on any screen — and the exported 1080×1920 is
 * re-rendered anyway, so this only ever governed the preview.
 */
const S = CARD_W / 300;
const s = (n: number) => Math.round(n * S);

/** What the exported image is, regardless of how small the preview is drawn. */
const STORY_W = 1080;
const STORY_H = 1920;

/**
 * The sticker is captured at its natural size, so these points become the
 * pixels Snapchat receives — see the matching note in ShareWeekModal.
 */
const STICKER_W = Math.min(WIN_W - 56, 330);

/**
 * How wide Snapchat draws it, in dp, before the user drags or pinches it.
 *
 * Wide and short by design: the sticker is a strip across the photo rather than
 * a block in the middle of it, and the middle is usually the food.
 */
const STICKER_DP = 300;

/**
 * Shareable story card. The web app draws an equivalent on a <canvas>; here
 * it's real views snapshotted with react-native-view-shot, so it inherits the
 * app's own type scale and colours instead of duplicating them in draw calls.
 */
export function ShareStoryModal({ visible, date, onClose }: ShareStoryModalProps) {
  const shotRef = useRef<View>(null);
  const [stats, setStats] = useState<ShareStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [mode, setMode] = useState<ShareMode>('card');

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setStats(null);
    setError(null);
    dashboardApi
      .getShareStats(date)
      .then((s) => !cancelled && setStats(s))
      .catch(() => !cancelled && setError("Couldn't build your card."));
    return () => {
      cancelled = true;
    };
  }, [visible, date]);

  /**
   * Snapshots the card at story resolution.
   *
   * The on-screen card is ~300pt wide because it has to fit in a sheet.
   * Capturing at that size produced a 300px image that Instagram and WhatsApp
   * then upscale to 1080 — soft, and it looked cheap next to everything else
   * in a feed. `width`/`height` re-render the view into a bitmap of that size,
   * so the text is redrawn sharp rather than stretched.
   */
  const capture = () =>
    mode === 'sticker'
      ? // Natural size, and no forced 9:16 frame: a sticker letterboxed into a
        // story-shaped canvas arrives in Snapchat as a small badge adrift in a
        // huge transparent box the user cannot crop.
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

      // NOT React Native's Share: on Android it ignores `url` entirely and
      // supports only `message`, so the intent went out carrying nothing and
      // WhatsApp reported "can't share empty file". expo-sharing attaches the
      // actual file, through a FileProvider, on both platforms.
      if (!(await Sharing.isAvailableAsync())) {
        setError('Sharing is not available on this device.');
        return;
      }
      await Sharing.shareAsync(uri, {
        mimeType: 'image/png',
        UTI: 'public.png',
        dialogTitle: 'Share your day',
      });
    } catch {
      setError("Couldn't share that card.");
    } finally {
      setSharing(false);
    }
  };

  /**
   * Straight into the Instagram story composer, skipping the share sheet.
   *
   * Android only — this is Instagram's documented ADD_TO_STORY intent. It fails
   * when Instagram isn't installed, and can fail on versions that require a
   * registered source application, so any failure falls back to the normal
   * share sheet rather than dead-ending the user. Instagram appears there too.
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
        // FLAG_GRANT_READ_URI_PERMISSION — without it Instagram receives a URI
        // it may not read and shows an empty composer.
        flags: 1,
      });
    } catch {
      await share().catch(() => setError("Couldn't share that card."));
    } finally {
      setSharing(false);
    }
  };

  /**
   * Snapchat, into the camera preview where a Snap is actually composed.
   *
   * **No fallback, on purpose.** This used to drop to a plain send intent and
   * then the system share sheet, which looked forgiving and was actively
   * harmful: both of those deliver the card to Snapchat as a *chat
   * attachment* — a message with a picture on it, no editor, no Story. The
   * button appeared to work, the user got something that was not a Snap, and
   * the real failure (a missing client ID, an unapproved portal entry,
   * Snapchat not installed) was invisible to everyone including us. It cost
   * days of debugging precisely because nothing ever reported an error.
   *
   * So it either reaches Snapchat's camera preview or it says why. Anyone who
   * genuinely wants to send the image as a file still has "More…" one row
   * below, which is honest about being a file share.
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
              // Wide and short now that the layout runs to the corners; the
              // old near-square ratio would have Snapchat reserve a block of
              // empty space under it.
              heightDp: Math.round(STICKER_DP * 0.62),
            })
          : await shareSnapToPreview(snapUri, SNAP_CLIENT_ID, 'NutriAI');

      if (!snapped) {
        setError(
          "Couldn't open Snapchat. Check that Snapchat is installed and up to date, then try again."
        );
      }
    } catch {
      setError("Couldn't open Snapchat.");
    } finally {
      setSharing(false);
    }
  };

  const caption = stats ? pickCaption(stats) : null;
  const pct = stats?.calories.goal
    ? Math.min(100, (stats.calories.consumed / stats.calories.goal) * 100)
    : 0;

  return (
    <Sheet visible={visible} onClose={onClose} title="Share your day">
      {!stats || !caption ? (
        error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <Loading label="Building your card…" />
        )
      ) : (
        <View style={styles.wrap}>
          {mode === 'sticker' ? (
            <View ref={shotRef} collapsable={false}>
              <DayShareSticker stats={stats} w={STICKER_W} />
            </View>
          ) : (
          <ViewShot ref={shotRef} style={styles.card}>
            <ShareCardBackground theme={caption.theme} width={CARD_W} height={CARD_H} />

            {/* Header */}
            <View style={styles.cardHead}>
              <Text style={styles.brand}>NUTRIAI</Text>
              <Text style={styles.date}>{formatCardDate(stats.date)}</Text>
            </View>

            {/* Editorial headline — the reason the card is worth posting */}
            {/*
              The slack sits above the headline rather than between it and the
              number. Rendered, a gap in the middle read as a void — the
              headline and the figure are one thought and were drifting apart —
              while the same space at the top edge reads as composition.
            */}
            <View style={styles.spacer} />

            <View style={styles.headlineBlock}>
              <Text style={styles.headline}>{caption.headline}</Text>
              <Text style={styles.sub}>{caption.sub}</Text>
            </View>

            {/* Hero figure */}
            <Text style={styles.kcal}>{stats.calories.consumed.toLocaleString()}</Text>
            <Text style={styles.kcalLabel}>
              KCAL{stats.calories.goal ? ` · GOAL ${stats.calories.goal.toLocaleString()}` : ''}
              {stats.steps != null ? ` · ${stats.steps.toLocaleString()} STEPS` : ''}
            </Text>

            <View style={styles.track}>
              <View style={[styles.fill, { width: `${pct}%` }]} />
            </View>

            {/* Supporting figures */}
            <View style={styles.stats}>
              <Figure value={`${Math.round(stats.protein.consumed)}g`} label="PROTEIN" />
              <Figure value={`${Math.round(stats.carbs_g)}g`} label="CARBS" />
              <Figure value={`${Math.round(stats.fat_g)}g`} label="FAT" />
            </View>


            <View style={styles.rule} />
            <Text style={styles.footer}>{stats.name}</Text>
          </ViewShot>
          )}

          <View style={styles.modeRow}>
            <ShareModeToggle mode={mode} onChange={setMode} disabled={sharing} />
          </View>

          {/* Instagram first on Android, because "share to a story" is the
              thing people actually came here to do; the sheet is the fallback
              and the only option on iOS, where ADD_TO_STORY needs a registered
              Facebook app to work at all. */}
          {Platform.OS === 'android' ? (
            <Button
              title={sharing ? 'Preparing…' : 'Instagram story'}
              onPress={shareToInstagram}
              disabled={sharing}
              style={styles.shareBtn}
            />
          ) : null}


          <Button
            title="Snapchat"
            variant={Platform.OS === 'android' ? 'ghost' : 'primary'}
            onPress={shareToSnapchat}
            disabled={sharing}
            style={styles.shareBtn}
          />

          <Button
            title={sharing ? 'Preparing…' : 'More…'}
            onPress={share}
            disabled={sharing}
            variant={Platform.OS === 'android' ? 'ghost' : 'primary'}
            style={styles.secondaryBtn}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      )}
    </Sheet>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.figureLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  modeRow: { alignSelf: 'stretch', marginTop: 14 },
  // Opaque: a transparent snapshot renders black in most share targets.
  /**
   * Padded for the chrome that sits on top of it, not for the frame it fills.
   *
   * Seen in Snapchat for the first time, the card was losing its ends: the
   * brand mark and date sat behind the music pill and the close button, and the
   * name along the bottom was under the send tray. Instagram does the same
   * thing at both ends, and neither is a bug we can fix in their UI — the card
   * has to assume roughly the top eighth and bottom sixth of a story are not
   * ours.
   *
   * Horizontal padding stays tight, because nothing in either app covers the
   * left and right of a *posted* story — the tool rail on the right only exists
   * while the sender is still editing.
   */
  card: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: 22,
    paddingTop: s(58),
    paddingBottom: s(70),
    paddingHorizontal: s(22),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    // Clips the oversized background rings to the rounded corners.
    overflow: 'hidden',
    backgroundColor: colors.bg,
  },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brand: { fontFamily: fonts.extrabold, fontSize: s(12), letterSpacing: 3 * S, color: colors.accent },
  date: { fontFamily: fonts.medium, fontSize: s(10), letterSpacing: 1.2 * S, color: colors.textDim },
  // marginBottom, not just top: with the slack moved above the headline there
  // was nothing holding the sub-line off the figure, and rendered they touched.
  headlineBlock: { marginTop: s(26), marginBottom: s(22) },
  headline: {
    fontFamily: fonts.extrabold,
    fontSize: s(34),
    lineHeight: 36,
    letterSpacing: -1,
    color: colors.text,
  },
  sub: { fontFamily: fonts.medium, fontSize: s(13), color: colors.textDim, marginTop: s(10) },
  spacer: { flex: 1 },
  kcal: {
    fontFamily: fonts.extrabold,
    fontSize: s(60),
    lineHeight: 62,
    letterSpacing: -2,
    color: colors.accent,
    fontVariant: ['tabular-nums'],
  },
  kcalLabel: { fontFamily: fonts.medium, fontSize: s(10), letterSpacing: 1.2 * S, color: colors.textDim, marginTop: s(4) },
  track: {
    height: s(6),
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 999,
    overflow: 'hidden',
    marginTop: s(14),
    marginBottom: s(18),
  },
  fill: { height: '100%', backgroundColor: colors.accent, borderRadius: 999 },
  stats: { flexDirection: 'row', gap: s(8), marginBottom: s(8) },
  figure: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 4,
    alignItems: 'center',
  },
  figureValue: {
    fontFamily: fonts.bold,
    fontSize: s(16),
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  figureLabel: { fontFamily: fonts.medium, fontSize: s(8), letterSpacing: 1 * S, color: colors.textDim, marginTop: s(3) },
  rule: { height: 1, backgroundColor: 'rgba(255,255,255,0.12)', marginTop: s(14), marginBottom: s(10) },
  footer: { fontFamily: fonts.semibold, fontSize: s(11), color: colors.textDim, letterSpacing: 0.4 },
  shareBtn: { marginTop: 18, alignSelf: 'stretch' },
  secondaryBtn: { marginTop: 8, alignSelf: 'stretch' },
  error: { ...type.body, color: colors.danger, textAlign: 'center', marginTop: 10 },
});
