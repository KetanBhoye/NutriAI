import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, ViewStyle } from 'react-native';
import { colors, radius } from '@/theme';

/**
 * Placeholder block that matches the shape of the content it stands in for.
 * Preferred over a centred spinner where the real content has a known size —
 * a spinner collapses the layout and everything jumps when data lands.
 */
export function Skeleton({ height = 16, width, style }: { height?: number; width?: ViewStyle['width']; style?: ViewStyle }) {
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return <Animated.View style={[styles.block, { height, width: width ?? '100%', opacity: pulse }, style]} />;
}

/** A card-shaped cluster of skeleton lines. */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <View style={styles.card}>
      <Skeleton height={14} width="45%" style={{ marginBottom: 14 }} />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={10} width={i === lines - 1 ? '70%' : '100%'} style={{ marginBottom: 8 }} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: colors.surface2, borderRadius: 6 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
  },
});
