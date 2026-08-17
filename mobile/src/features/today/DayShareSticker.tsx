import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/theme';
import type { ShareStats } from '@/api/dashboard';
import { StickerFrame, stickerStyles } from '../share/StickerFrame';
import { formatCardDate } from './shareCaption';

/**
 * The day, as a sticker to drop on your own photo.
 *
 * The card version of this is a poster: it owns the frame, so it can afford a
 * headline, a caption and a stat grid. A sticker is a *label on someone else's
 * picture* — usually the meal they just shot — so it earns its space by adding
 * the one thing the photo cannot say, and then getting out of the way.
 *
 * That one thing is the calorie figure against the goal. Everything that made
 * the card good and this bad was cut:
 *
 *  - **No headline.** "TODAY'S THE DAY." is doing the work of a caption, and on
 *    a sticker the photo is the caption.
 *  - **No steps, streak or weight.** Four stats on a panel this size shrinks the
 *    hero figure to the size of the labels, and the hero figure is the reason
 *    anyone looks.
 *  - **Macros stay**, as one quiet row. They are the detail that makes the
 *    number credible rather than a boast, and they cost one line.
 *
 * The progress bar is the only ornament, and it is here because it is the
 * fastest read on the whole sticker: someone scrolling a Story sees a bar
 * mostly-full or barely-started long before they parse "1,430".
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
   * Green while there is room, amber once the goal is passed.
   *
   * Never red. A day over target is an ordinary day, and this image is
   * something the person chose to show people — colouring it as a failure is
   * both wrong and unkind.
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
      <View style={[styles.figureRow, { marginTop: w * 0.045 }]}>
        <Text style={[stickerStyles.figure, { fontSize: w * 0.2, color: accent }]}>
          {consumed.toLocaleString()}
        </Text>
        <Text style={[stickerStyles.unit, { fontSize: w * 0.05, marginBottom: w * 0.025 }]}>
          {goal ? ` / ${goal.toLocaleString()}` : ' kcal'}
        </Text>
      </View>
      <Text style={[styles.label, { fontSize: w * 0.036 }]}>
        {goal ? 'KCAL AGAINST GOAL' : 'KCAL LOGGED'}
      </Text>

      {goal ? (
        <View style={[styles.track, { height: w * 0.022, borderRadius: w * 0.011, marginTop: w * 0.05 }]}>
          <View
            style={{
              width: `${pct}%`,
              height: '100%',
              borderRadius: w * 0.011,
              backgroundColor: accent,
            }}
          />
        </View>
      ) : null}

      <View style={[styles.macros, { marginTop: w * 0.05, gap: w * 0.05 }]}>
        <Macro w={w} value={Math.round(stats.protein.consumed)} label="PROTEIN" />
        <Macro w={w} value={Math.round(stats.carbs_g)} label="CARBS" />
        <Macro w={w} value={Math.round(stats.fat_g)} label="FAT" />
      </View>
    </StickerFrame>
  );
}

function Macro({ w, value, label }: { w: number; value: number; label: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={[styles.macroValue, { fontSize: w * 0.055 }]}>{value}g</Text>
      <Text style={[styles.macroLabel, { fontSize: w * 0.03, marginTop: w * 0.008 }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  figureRow: { flexDirection: 'row', alignItems: 'flex-end' },
  label: {
    color: 'rgba(255,255,255,0.45)',
    fontFamily: fonts.bold,
    letterSpacing: 2,
    marginTop: -2,
  },
  track: { width: '100%', backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  macros: { flexDirection: 'row' },
  macroValue: { color: colors.text, fontFamily: fonts.bold },
  macroLabel: { color: 'rgba(255,255,255,0.4)', fontFamily: fonts.semibold, letterSpacing: 1.1 },
});
