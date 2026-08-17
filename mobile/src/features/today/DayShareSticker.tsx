import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/theme';
import type { ShareStats } from '@/api/dashboard';
import { MacroMetrics } from '../share/overlay/MacroMetrics';
import { ProgressMetric } from '../share/overlay/ProgressMetric';
import { StreakRing } from '../share/overlay/StreakRing';
import { overlayShadow } from '../share/overlay/shadow';
import { formatCardDate, pickCaption } from './shareCaption';

/**
 * The day as a full-frame overlay on the user's own photo.
 *
 * Three attempts got here and each dead end is worth recording, because all
 * three looked fine in a preview and wrong on an actual Snap:
 *
 *  1. **A dark rounded panel.** A card pasted onto someone's picture, sitting
 *     over the middle — the part they framed the shot around.
 *  2. **The same panel with its contents in the corners.** No better: the panel
 *     was the problem, not the arrangement inside it.
 *  3. **Blocks positioned at fixed fractions of the height.** Fine until a
 *     metric grows a caption and a progress bar; then it overruns the block
 *     beneath it. First the flame landed on the step goal, and once that was
 *     fixed with gaps, the rail grew past the caption pinned to the bottom and
 *     the headline printed straight through the macros.
 *
 * So nothing is positioned by guessed fraction any more. The whole composition
 * is one column pinned between the top and bottom insets with `space-between`,
 * which makes overlap structurally impossible and the rhythm even by
 * construction — whatever the content turns out to be. Metrics vary: one user
 * has a step goal and a protein target, another has neither, and the spacing
 * has to hold for both.
 *
 * Only data the user actually has appears. There is no water row: NutriAI does
 * not track water, and a card someone posts publicly is the last place to
 * invent a number. A metric with no goal renders as a figure with no bar,
 * rather than a bar at zero implying a target they never set.
 */

interface Props {
  stats: ShareStats;
  /** Sticker width in points. */
  w: number;
}

/** Full-frame: this overlay frames the photo rather than sitting on part of it. */
export const STICKER_ASPECT = 16 / 9;

/**
 * The band the composition lives in.
 *
 * Top and bottom are left clear of the host app's chrome — Snapchat puts a
 * music pill and a close button across the top and a send tray across the
 * bottom — and the rail is kept to the left ~45% so the middle of the frame,
 * where the subject of a photo almost always is, stays open.
 */
const RAIL = 0.075;
const TOP = 0.13;
const BOTTOM = 0.14;

export function DayShareSticker({ stats, w }: Props) {
  const h = Math.round(w * STICKER_ASPECT);
  const goal = stats.calories.goal;
  const consumed = stats.calories.consumed;
  const pct = goal ? Math.min(1, consumed / goal) : null;

  // Amber once the goal is passed, never red: a day over target is an ordinary
  // day, and this is something the person chose to show people.
  const over = goal !== null && consumed > goal;
  const accent = over ? '#fbbf24' : colors.accent;
  const caption = pickCaption(stats);
  const stepGoal = stats.steps_goal ?? null;

  return (
    <View style={{ width: w, height: h }}>
      {/*
        One column, pinned top and bottom, spaced by layout. The caption is the
        last child rather than a separately positioned element, which is what
        stops it ever meeting the macros above it.
      */}
      <View
        style={{
          position: 'absolute',
          left: w * RAIL,
          top: h * TOP,
          bottom: h * BOTTOM,
          width: w * 0.46,
          justifyContent: 'space-between',
        }}
      >
        <View>
          <Text style={[styles.eyebrow, { fontSize: w * 0.038 }]}>TODAY</Text>
          <Text style={[styles.date, { fontSize: w * 0.034, marginTop: w * 0.008 }]}>
            {formatCardDate(stats.date)}
          </Text>
        </View>

        <ProgressMetric
          w={w}
          icon="👟"
          label="STEPS"
          value={stats.steps != null ? stats.steps.toLocaleString() : '—'}
          caption={stepGoal ? `Goal ${stepGoal.toLocaleString()}` : null}
          progress={stepGoal && stats.steps != null ? stats.steps / stepGoal : null}
        />

        <ProgressMetric
          w={w}
          icon="🔥"
          label="KCAL"
          value={consumed.toLocaleString()}
          caption={goal ? `${Math.round((consumed / goal) * 100)}% of ${goal.toLocaleString()}` : null}
          progress={pct}
          accent={accent}
          emphasis
        />

        <MacroMetrics
          w={w}
          macros={[
            { label: 'Protein', grams: stats.protein.consumed, goal: stats.protein.goal },
            { label: 'Carbs', grams: stats.carbs_g, goal: stats.carbs_goal_g },
            { label: 'Fat', grams: stats.fat_g, goal: stats.fat_goal_g },
          ]}
        />

        {/*
          The line that makes this a post rather than a readout — the same copy
          the full card uses as its headline, so the two share a voice.
        */}
        <View>
          <Text style={[styles.caption, { fontSize: w * 0.055 }]}>{caption.headline}</Text>
          <Text style={[styles.brand, { fontSize: w * 0.032, marginTop: w * 0.014 }]}>NUTRIAI</Text>
        </View>
      </View>

      {/*
        The streak, opposite the rail rather than aligned to any one metric in
        it. Vertically it sits on the frame's own third, which keeps it clear of
        both the top chrome and the caption no matter how tall the rail grows.
      */}
      {stats.streak > 0 ? (
        <View style={{ position: 'absolute', right: w * RAIL, top: h * 0.3 }}>
          <StreakRing w={w} days={stats.streak} />
        </View>
      ) : null}

    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: { color: colors.accent, fontFamily: fonts.bold, letterSpacing: 3, ...overlayShadow },
  date: {
    color: 'rgba(255,255,255,0.65)',
    fontFamily: fonts.semibold,
    letterSpacing: 0.8,
    ...overlayShadow,
  },
  caption: { color: colors.text, fontFamily: fonts.bold, ...overlayShadow },
  brand: {
    color: 'rgba(255,255,255,0.55)',
    fontFamily: fonts.bold,
    letterSpacing: 3,
    ...overlayShadow,
  },
});
