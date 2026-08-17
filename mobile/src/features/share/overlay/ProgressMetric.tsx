import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/theme';
import { overlayShadow } from './shadow';

/**
 * One metric in the overlay rail: a figure, its target, and a thin bar.
 *
 * Sized entirely from `w` — the width of the *sticker*, not the screen — so the
 * same component renders identically whether it is previewed at 340pt in a
 * sheet or captured at Story resolution.
 *
 * There is no card behind it. Everything sits directly on the user's photo, so
 * every piece of text carries its own shadow (see `shadow.ts`) and the bar has
 * a translucent white track rather than a dark one, which would read as a
 * rectangle over a bright picture.
 *
 * A null goal draws no bar at all. Someone who has never set a step target
 * should see their step count, not a bar pinned at zero implying they failed at
 * something they never chose.
 */

interface Props {
  /** Sticker width in points; all type and spacing derive from it. */
  w: number;
  icon: string;
  label: string;
  /** The headline number, already formatted. */
  value: string;
  /** Small text under the bar, e.g. "Goal 10,000" or "66% of goal". */
  caption?: string | null;
  /** 0–1. Null hides the bar. */
  progress: number | null;
  /** Bar colour; also the figure's when `emphasis` is set. */
  accent?: string;
  /**
   * Whether this is the metric of the pair.
   *
   * Only one figure in the rail is coloured. Calories is the number the day is
   * actually about, so it takes the accent; steps stays white. Colouring both
   * flattens them into a list of equal facts and the eye has nowhere to land.
   */
  emphasis?: boolean;
}

export function ProgressMetric({
  w,
  icon,
  label,
  value,
  caption,
  progress,
  accent,
  emphasis,
}: Props) {
  const tint = accent ?? colors.accent;

  return (
    <View style={{ width: w * 0.42 }}>
      <Text style={[styles.icon, { fontSize: w * 0.05 }]}>{icon}</Text>
      <Text style={[styles.value, { fontSize: w * 0.105, color: emphasis ? tint : colors.text }]}>
        {value}
      </Text>
      <Text style={[styles.label, { fontSize: w * 0.028 }]}>{label}</Text>

      {caption ? (
        <Text style={[styles.caption, { fontSize: w * 0.029, marginTop: w * 0.012 }]}>
          {caption}
        </Text>
      ) : null}

      {progress !== null ? (
        <View style={[styles.track, { height: w * 0.011, marginTop: w * 0.016 }]}>
          <View
            style={{
              width: `${Math.max(0, Math.min(1, progress)) * 100}%`,
              height: '100%',
              backgroundColor: tint,
              borderRadius: w * 0.006,
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  icon: { ...overlayShadow },
  value: { fontFamily: fonts.bold, letterSpacing: -1, includeFontPadding: false, ...overlayShadow },
  label: {
    color: 'rgba(255,255,255,0.72)',
    fontFamily: fonts.bold,
    letterSpacing: 2,
    ...overlayShadow,
  },
  caption: { color: 'rgba(255,255,255,0.62)', fontFamily: fonts.semibold, ...overlayShadow },
  track: {
    width: '100%',
    // Translucent white, not a dark fill: a dark track would outline itself as
    // a rectangle on a bright photo, which is the thing this design avoids.
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 999,
    overflow: 'hidden',
  },
});
