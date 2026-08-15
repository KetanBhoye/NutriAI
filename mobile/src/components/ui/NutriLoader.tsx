import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, Stop } from 'react-native-svg';
import { colors, type } from '@/theme';

/**
 * The app's own loader: a macro ring closing, with a leaf breathing inside it.
 *
 * A stock `ActivityIndicator` is the same grey spinner every app on the phone
 * uses, which is a small thing that reads as "unfinished" everywhere it
 * appears. This is the shape the product is already about — the daily ring —
 * so waiting looks like part of the app rather than a gap in it.
 *
 * Built on `Animated` with `react-native-svg`, both already dependencies. The
 * rotation and the leaf's pulse run on the **native driver**, so they stay
 * smooth while JavaScript is busy — which, during a load, it is. The arc
 * length cannot use the native driver (it drives an SVG prop, not a
 * transform), so it is deliberately the one thing that is allowed to stutter.
 */

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface NutriLoaderProps {
  /** Diameter in px. 44 and up keeps the leaf readable. */
  size?: number;
  label?: string;
  /** Hides the leaf for use inside small controls. */
  bare?: boolean;
}

export function NutriLoader({ size = 64, label, bare = false }: NutriLoaderProps) {
  const spin = useRef(new Animated.Value(0)).current;
  const sweep = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;

  const stroke = Math.max(3, size * 0.09);
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;

  useEffect(() => {
    const rotation = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1400,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );

    // The arc grows and shrinks rather than sitting at a fixed length, so the
    // ring reads as working rather than as a static progress value the user
    // might try to interpret.
    const sweeping = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(sweep, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
      ])
    );

    const breathing = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    rotation.start();
    sweeping.start();
    breathing.start();
    return () => {
      rotation.stop();
      sweeping.stop();
      breathing.stop();
    };
  }, [spin, sweep, breathe]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const dashOffset = sweep.interpolate({
    inputRange: [0, 1],
    // From a short arc to most of the ring, never the whole of it — a closed
    // ring stops reading as motion once the rotation is the only cue left.
    outputRange: [circumference * 0.78, circumference * 0.18],
  });
  const leafScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1.06] });
  const leafOpacity = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });

  return (
    <View style={styles.wrap}>
      <View style={{ width: size, height: size }}>
        <Animated.View style={{ transform: [{ rotate }] }}>
          <Svg width={size} height={size}>
            <Defs>
              <LinearGradient id="nutriArc" x1="0%" y1="100%" x2="100%" y2="0%">
                <Stop offset="0%" stopColor={colors.accentDim} />
                <Stop offset="100%" stopColor="#a7f3d0" />
              </LinearGradient>
            </Defs>
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke={colors.surface2}
              strokeWidth={stroke}
              fill="none"
            />
            <AnimatedCircle
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke="url(#nutriArc)"
              strokeWidth={stroke}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
            />
          </Svg>
        </Animated.View>

        {bare ? null : (
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              styles.leafWrap,
              { opacity: leafOpacity, transform: [{ scale: leafScale }] },
            ]}
            pointerEvents="none"
          >
            <Svg width={size} height={size} viewBox="0 0 24 24">
              <G>
                <Path
                  d="M12 4c4.2 1 5.6 5 3.4 7.8C13.6 14.2 10 13.7 8.9 11.3 7.9 9.1 9 5.6 12 4Z"
                  fill={colors.accent}
                />
                <Path
                  d="M11.6 13.6c-.2-2.6.6-4.9 2.4-6.4"
                  stroke={colors.bg}
                  strokeWidth={1.1}
                  strokeLinecap="round"
                  fill="none"
                />
              </G>
            </Svg>
          </Animated.View>
        )}
      </View>

      {label ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', gap: 14 },
  leafWrap: { alignItems: 'center', justifyContent: 'center' },
  label: { ...type.caption, color: colors.textDim, textAlign: 'center' },
});
