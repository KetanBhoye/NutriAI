import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { colors, fonts, radius, space } from '@/theme';
import type { Moment } from './moments';

/**
 * How a milestone is shown.
 *
 * No confetti. On a dark, data-dense screen it reads as cheap, and it is the
 * visual language of a game rather than a tool someone is using to change
 * their body. The reference points here are Apple's ring close and Strava's
 * personal bests: a swell of light, a haptic, a specific sentence, gone in a
 * couple of seconds.
 *
 * Everything animates on the native driver, because this fires immediately
 * after a save — precisely when JavaScript is busy writing and re-reading, and
 * a celebration that stutters is worse than none.
 */

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const DISMISS_AFTER_MS = 4200;

export function CelebrationCard({
  moment,
  onDismiss,
}: {
  moment: Moment;
  onDismiss: () => void;
}) {
  const enter = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Success for a real milestone, a lighter tap for a daily target. The
    // difference is felt before anything is read.
    void Haptics.notificationAsync(
      moment.weight === 'major'
        ? Haptics.NotificationFeedbackType.Success
        : Haptics.NotificationFeedbackType.Warning
    ).catch(() => {});

    const animation = Animated.parallel([
      Animated.spring(enter, {
        toValue: 1,
        damping: 14,
        stiffness: 140,
        mass: 0.9,
        useNativeDriver: true,
      }),
      // The ring closing: the whole idea, borrowed openly from Apple Fitness.
      Animated.timing(ring, {
        toValue: 1,
        duration: 900,
        delay: 120,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: 520,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0.55,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    ]);

    animation.start();
    const timer = setTimeout(onDismiss, DISMISS_AFTER_MS);

    return () => {
      animation.stop();
      clearTimeout(timer);
    };
  }, [enter, ring, glow, moment, onDismiss]);

  const size = 46;
  const stroke = 4;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;

  return (
    <Animated.View
      style={[
        styles.wrap,
        moment.weight === 'major' && styles.wrapMajor,
        {
          opacity: enter,
          transform: [
            { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) },
            { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) },
          ],
        },
      ]}
    >
      <Pressable style={styles.row} onPress={onDismiss} accessibilityRole="button">
        <View style={styles.markWrap}>
          <Animated.View style={[styles.markGlow, { opacity: glow }]} />
          <Svg width={size} height={size}>
            <Defs>
              <LinearGradient id="celebrateArc" x1="0%" y1="100%" x2="100%" y2="0%">
                <Stop offset="0%" stopColor={colors.accentDim} />
                <Stop offset="100%" stopColor="#d1fae5" />
              </LinearGradient>
            </Defs>
            <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.surface2} strokeWidth={stroke} fill="none" />
            <AnimatedCircle
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke="url(#celebrateArc)"
              strokeWidth={stroke}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={circumference}
              strokeDashoffset={ring.interpolate({
                inputRange: [0, 1],
                outputRange: [circumference, 0],
              })}
              // Start the arc at twelve o'clock rather than three.
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          </Svg>
        </View>

        <View style={styles.text}>
          <Text style={styles.title}>{moment.title}</Text>
          <Text style={styles.detail}>{moment.detail}</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: 'rgba(74,222,128,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.30)',
    borderRadius: radius,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    marginBottom: space.md,
  },
  // A milestone gets a touch more presence than a daily target, and no more.
  wrapMajor: {
    backgroundColor: 'rgba(74,222,128,0.12)',
    borderColor: 'rgba(74,222,128,0.45)',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  markWrap: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
  markGlow: {
    position: 'absolute',
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(74,222,128,0.35)',
  },
  text: { flex: 1 },
  title: { color: colors.text, fontSize: 15, fontFamily: fonts.semibold },
  detail: { color: colors.textDim, fontSize: 12.5, lineHeight: 17, marginTop: 2 },
});
