import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, ViewStyle } from 'react-native';
import { colors } from '@/theme';

/**
 * A progress bar that travels to its value instead of appearing at it.
 *
 * The point is not decoration: logging a food is the app's core action, and
 * watching the bar move is the confirmation that it counted. A bar that jumps
 * gives no sense of *how much* the meal cost — the distance travelled is the
 * information.
 *
 * `width` cannot use the native driver, so this animates `scaleX` on a
 * full-width fill instead, anchored left. That keeps it on the UI thread's
 * cheap path and smooth while the list behind it re-renders.
 */
export function AnimatedBar({
  percent,
  height = 8,
  color = colors.accent,
  track = colors.surface2,
  style,
}: {
  percent: number;
  height?: number;
  color?: string;
  track?: string;
  style?: ViewStyle;
}) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const grow = useRef(new Animated.Value(0)).current;
  // Skips the entrance animation only for the very first paint of a screen
  // that already has data, so switching days doesn't replay every bar.
  const started = useRef(false);

  useEffect(() => {
    Animated.timing(grow, {
      toValue: clamped / 100,
      duration: started.current ? 420 : 620,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    started.current = true;
  }, [clamped, grow]);

  return (
    <View style={[styles.track, { height, backgroundColor: track }, style]}>
      <Animated.View
        style={[
          styles.fill,
          {
            backgroundColor: color,
            // scaleX from a left anchor: the fill is laid out full width and
            // squashed, which the native driver can do and `width` cannot.
            transform: [{ scaleX: grow }],
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { borderRadius: 999, overflow: 'hidden' },
  fill: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    // The anchor for scaleX. Without it the bar grows from its centre.
    transform: [{ scaleX: 0 }],
    transformOrigin: 'left',
  },
});
