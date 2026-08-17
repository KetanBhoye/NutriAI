import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/theme';
import type { ShareStats } from '@/api/dashboard';
import { StickerFrame, stickerStyles } from '../share/StickerFrame';
import { formatCardDate } from './shareCaption';

/**
 * The day, as a sticker to drop on your own photo.
 *
 * Laid out to the corners rather than down the middle. A centred stack reads as
 * a *panel someone pasted on*; anchoring the two numbers to opposite corners
 * and letting the detail sit along the bottom reads as a HUD over the photo,
 * which is what a Snapchat overlay is. It also lets the whole thing be wide and
 * short instead of squarish, so it covers a strip of the picture rather than
 * the middle of it — and the middle is where the food usually is.
 *
 * Steps sit on the left because they are the half people react to. Calories
 * against goal is the number that means something to the person logging;
 * "4,604 steps" is the one a friend replies to. Putting the social number first
 * in reading order is the difference between a stat card and a post.
 *
 * The card version stays a poster — headline, caption, big single figure. This
 * is deliberately the other shape, because it has a different job.
 */

interface Props {
  stats: ShareStats;
  /** Sticker width in points. */
  w: number;
}

export function DayShareSticker({ stats, w }: Props) {
  const goal = stats.calories.goal;
  const consumed = stats.calories.consumed;
  const pct = goal ? Math.min(100, (consumed / goal) * 100) : 0;

  /**
   * Green while there is room, amber once the goal is passed. Never red — a day
   * over target is an ordinary day, and this is something the person chose to
   * show people.
   */
  const over = goal !== null && consumed > goal;
  const accent = over ? '#fbbf24' : colors.accent;

  return (
    <StickerFrame
      w={w}
      accent={accent}
      eyebrow="TODAY"
      meta={formatCardDate(stats.date)}
      note={stats.streak > 1 ? `${stats.streak} DAY STREAK` : null}
    >
      {/*
        The two corners. Steps left, calories right, baselines shared — the
        alignment is what makes them read as a pair rather than two stacks that
        happen to be adjacent.
      */}
      <View style={[styles.corners, { marginTop: w * 0.05 }]}>
        <View style={styles.corner}>
          <Text style={[stickerStyles.figure, { fontSize: w * 0.115 }]}>
            {stats.steps != null ? stats.steps.toLocaleString() : '—'}
          </Text>
          <Text style={[styles.label, { fontSize: w * 0.03 }]}>STEPS</Text>
        </View>

        <View style={[styles.corner, styles.right]}>
          <View style={styles.figureRow}>
            <Text style={[stickerStyles.figure, { fontSize: w * 0.115, color: accent }]}>
              {consumed.toLocaleString()}
            </Text>
            {goal ? (
              <Text style={[stickerStyles.unit, { fontSize: w * 0.038, marginBottom: w * 0.012 }]}>
                {` / ${goal.toLocaleString()}`}
              </Text>
            ) : null}
          </View>
          <Text style={[styles.label, { fontSize: w * 0.03, textAlign: 'right' }]}>KCAL</Text>
        </View>
      </View>

      {/*
        The fastest read on the sticker: mostly-full or barely-started lands
        before anyone parses a four-digit number.
      */}
      {goal ? (
        <View
          style={[styles.track, { height: w * 0.016, borderRadius: w * 0.008, marginTop: w * 0.04 }]}
        >
          <View
            style={{
              width: `${pct}%`,
              height: '100%',
              borderRadius: w * 0.008,
              backgroundColor: accent,
            }}
          />
        </View>
      ) : null}

      {/*
        Macros as one quiet line rather than three tiles. At sticker size the
        tiles from the card become boxes with numbers too small to read, and the
        detail here is only there to make the headline figures credible.
      */}
      <Text style={[styles.macros, { fontSize: w * 0.036, marginTop: w * 0.038 }]}>
        {Math.round(stats.protein.consumed)}g protein
        <Text style={styles.dot}> · </Text>
        {Math.round(stats.carbs_g)}g carbs
        <Text style={styles.dot}> · </Text>
        {Math.round(stats.fat_g)}g fat
      </Text>
    </StickerFrame>
  );
}

const styles = StyleSheet.create({
  corners: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  corner: { flexShrink: 1 },
  right: { alignItems: 'flex-end' },
  figureRow: { flexDirection: 'row', alignItems: 'flex-end' },
  label: {
    color: 'rgba(255,255,255,0.42)',
    fontFamily: fonts.bold,
    letterSpacing: 1.8,
    marginTop: -1,
  },
  track: { width: '100%', backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  macros: { color: 'rgba(255,255,255,0.72)', fontFamily: fonts.semibold },
  dot: { color: 'rgba(255,255,255,0.3)' },
});
