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
 * Three attempts got here, and the two dead ends are worth recording because
 * both looked fine in a preview and wrong on an actual Snap:
 *
 *  1. **A dark rounded panel.** A card pasted onto a photo, sitting over the
 *     middle — the part someone framed the shot around.
 *  2. **The same panel with its contents pushed to the corners.** No better:
 *     the panel was the problem, not the arrangement inside it.
 *
 * So the metrics are distributed around the *edges of the frame* and the middle
 * is left alone. The photo is the post; this is the layer that annotates it,
 * and everything here is arranged so a person standing in the centre of their
 * own picture is never covered.
 *
 * Only data the user actually has appears. There is no water row, no
 * "0 of 8 glasses" — NutriAI does not track water, and a shared card is exactly
 * the wrong place to invent a number. Metrics without a goal render as a figure
 * with no bar rather than a bar at zero.
 *
 * Positions are fractions of the sticker's own width and height, never pixels,
 * so the composition survives being previewed at 340pt and captured at Story
 * resolution — and survives the aspect differences between phones.
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
 * Top and bottom are left clear for the host app's chrome — Snapchat puts a
 * music pill and close button across the top and a send tray across the bottom
 * — and the middle 40% is left clear for the subject of the photo.
 */
const RAIL_LEFT = 0.07;
const RAIL_RIGHT = 0.07;
const TOP = 0.1;
const BOTTOM = 0.12;

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
      {/* Top-left: whose day, and which one. */}
      <View style={{ position: 'absolute', left: w * RAIL_LEFT, top: h * TOP }}>
        <Text style={[styles.eyebrow, { fontSize: w * 0.036 }]}>TODAY</Text>
        <Text style={[styles.date, { fontSize: w * 0.032, marginTop: w * 0.006 }]}>
          {formatCardDate(stats.date)}
        </Text>
      </View>

      {/* Upper-left rail: steps. */}
      <View style={{ position: 'absolute', left: w * RAIL_LEFT, top: h * (TOP + 0.075) }}>
        <ProgressMetric
          w={w}
          icon="👟"
          label="STEPS"
          value={stats.steps != null ? stats.steps.toLocaleString() : '—'}
          caption={stepGoal ? `Goal ${stepGoal.toLocaleString()}` : null}
          progress={stepGoal && stats.steps != null ? stats.steps / stepGoal : null}
        />
      </View>

      {/* Mid-left: calories, the number the day is about. */}
      <View style={{ position: 'absolute', left: w * RAIL_LEFT, top: h * 0.33 }}>
        <ProgressMetric
          w={w}
          icon="🔥"
          label="KCAL"
          value={goal ? `${consumed.toLocaleString()}` : consumed.toLocaleString()}
          caption={goal ? `${Math.round((consumed / goal) * 100)}% of ${goal.toLocaleString()}` : null}
          progress={pct}
          accent={accent}
          emphasis
        />
      </View>

      {/* Lower-left: macros. */}
      <View style={{ position: 'absolute', left: w * RAIL_LEFT, top: h * 0.52 }}>
        <MacroMetrics
          w={w}
          macros={[
            { label: 'Protein', grams: stats.protein.consumed, goal: stats.protein.goal },
            { label: 'Carbs', grams: stats.carbs_g, goal: stats.carbs_goal_g },
            { label: 'Fat', grams: stats.fat_g, goal: stats.fat_goal_g },
          ]}
        />
      </View>

      {/* Right, opposite the calorie block: the streak. */}
      {stats.streak > 0 ? (
        <View style={{ position: 'absolute', right: w * RAIL_RIGHT, top: h * 0.36 }}>
          <StreakRing w={w} days={stats.streak} />
        </View>
      ) : null}

      {/*
        Bottom-left: the line that makes it a post rather than a readout. The
        same copy the full card uses as its headline, so the two share a voice.
      */}
      <View
        style={{
          position: 'absolute',
          left: w * RAIL_LEFT,
          right: w * RAIL_RIGHT,
          bottom: h * BOTTOM,
        }}
      >
        <Text style={[styles.caption, { fontSize: w * 0.044 }]}>{caption.headline}</Text>
        <Text style={[styles.brand, { fontSize: w * 0.03, marginTop: w * 0.01 }]}>NUTRIAI</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: { color: colors.accent, fontFamily: fonts.bold, letterSpacing: 2.6, ...overlayShadow },
  date: { color: 'rgba(255,255,255,0.62)', fontFamily: fonts.semibold, letterSpacing: 0.6, ...overlayShadow },
  caption: { color: colors.text, fontFamily: fonts.bold, ...overlayShadow },
  brand: { color: 'rgba(255,255,255,0.55)', fontFamily: fonts.bold, letterSpacing: 2.4, ...overlayShadow },
});
