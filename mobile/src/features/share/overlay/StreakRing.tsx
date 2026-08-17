import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { BrandMark } from '@/components/BrandMark';
import { colors, fonts } from '@/theme';
import { overlayShadow } from './shadow';

/**
 * The streak, as a ring on the right edge.
 *
 * The one round thing in a layout of straight rails, which is what lets it sit
 * opposite the metrics without competing with them: the eye reads it as a
 * different kind of object rather than a fourth statistic.
 *
 * The arc is capped at a week. A streak has no target — it is not out of
 * anything — so the ring is a *rhythm* rather than a progress bar: it fills
 * across a week and starts again, which is the unit people actually think in.
 * Drawing 2/365 would be technically honest and visually useless, and drawing a
 * full circle for every streak would make day two look like day two hundred.
 */

const WEEK = 7;

export function StreakRing({ w, days }: { w: number; days: number }) {
  const size = w * 0.28;
  const stroke = w * 0.016;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const filled = Math.min(1, (days % WEEK === 0 ? WEEK : days % WEEK) / WEEK);

  return (
    <View style={{ width: size, alignItems: 'center' }}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke="rgba(255,255,255,0.22)"
            strokeWidth={stroke}
            fill="none"
          />
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={colors.accent}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${circumference * filled} ${circumference}`}
            // Start at twelve o'clock rather than three, which is where a ring
            // is read from.
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </Svg>

        <BrandMark size={w * 0.05} />
        <Text style={[styles.days, { fontSize: w * 0.095, marginTop: w * 0.004 }]}>{days}</Text>
      </View>
      <Text style={[styles.label, { fontSize: w * 0.026, marginTop: w * 0.008 }]}>DAY STREAK</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  days: {
    color: colors.text,
    fontFamily: fonts.bold,
    letterSpacing: -1,
    includeFontPadding: false,
    ...overlayShadow,
  },
  label: {
    color: 'rgba(255,255,255,0.72)',
    fontFamily: fonts.bold,
    letterSpacing: 1.8,
    ...overlayShadow,
  },
});
