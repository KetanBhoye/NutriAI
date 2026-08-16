import { useEffect, useRef } from 'react';
import { Animated, Easing, ViewStyle } from 'react-native';

/**
 * Fades and lifts its children into place once, on mount.
 *
 * Used for the day's food entries. Without it a day's log appears fully formed
 * the instant the request lands, which reads as a flash — especially when the
 * cached copy paints first and the fresh one replaces it a moment later.
 *
 * `index` staggers the rows so the list assembles top-down instead of
 * everything arriving at once. The stagger is capped: past a handful of rows
 * the delay stops reading as sequence and starts reading as lag, and a heavy
 * logging day can be twenty entries.
 */
const STAGGER_MS = 40;
const MAX_STAGGER_STEPS = 6;

export function FadeIn({
  children,
  index = 0,
  distance = 8,
  duration = 260,
  style,
}: {
  children: React.ReactNode;
  index?: number;
  distance?: number;
  duration?: number;
  style?: ViewStyle;
}) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(t, {
      toValue: 1,
      duration,
      delay: Math.min(index, MAX_STAGGER_STEPS) * STAGGER_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [t, index, duration]);

  return (
    <Animated.View
      style={[
        {
          opacity: t,
          transform: [
            { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) },
          ],
        },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}
