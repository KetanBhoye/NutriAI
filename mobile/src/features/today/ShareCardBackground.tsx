import Svg, { Circle, Defs, LinearGradient, Rect, Stop, RadialGradient } from 'react-native-svg';
import { StyleSheet } from 'react-native';

/**
 * Backdrop for the share card.
 *
 * Drawn with react-native-svg rather than expo-linear-gradient because svg is
 * already a dependency (the Plan chart) and it can do radial glows, which a
 * plain linear gradient can't — the soft off-canvas blooms are what stop the
 * card reading as a flat rectangle.
 *
 * The palette keys off what the day actually earned, so a streak card and a
 * steps card don't look identical in a feed.
 */
export type CardTheme = 'streak' | 'protein' | 'steps' | 'dialed' | 'default';

interface Palette {
  /** Base fill — near-black, faintly tinted toward the accent. */
  base: string;
  /** Warm glow, top-left. */
  glowA: string;
  /** Cool glow, bottom-right. */
  glowB: string;
  /** Hairline ring echoing the app icon. */
  ring: string;
}

const PALETTES: Record<CardTheme, Palette> = {
  // Gold: rare, so it should feel like an award.
  streak: { base: '#15120c', glowA: '#fbbf24', glowB: '#f97316', ring: '#fbbf24' },
  // Brand green, pushed saturated.
  protein: { base: '#0c1510', glowA: '#4ade80', glowB: '#14b8a6', ring: '#4ade80' },
  // Cyan reads as motion/distance.
  steps: { base: '#0a1218', glowA: '#5ad1ff', glowB: '#4ade80', ring: '#5ad1ff' },
  // Calm green/teal for a day held in check.
  dialed: { base: '#0b1412', glowA: '#4ade80', glowB: '#5ad1ff', ring: '#4ade80' },
  // Muted violet so a plain day still looks considered.
  default: { base: '#0f1115', glowA: '#a98bff', glowB: '#5ad1ff', ring: '#a98bff' },
};

export function themeForCaption(headline: string): CardTheme {
  if (headline.includes('NO MISSES')) return 'streak';
  if (headline.includes('PROTEIN')) return 'protein';
  if (headline.includes('STEPS')) return 'steps';
  if (headline.includes('DIALED')) return 'dialed';
  return 'default';
}

export function ShareCardBackground({ theme, width, height }: { theme: CardTheme; width: number; height: number }) {
  const p = PALETTES[theme];

  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
      <Defs>
        <RadialGradient id="glowA" cx="18%" cy="12%" rx="85%" ry="55%">
          <Stop offset="0" stopColor={p.glowA} stopOpacity="0.42" />
          <Stop offset="1" stopColor={p.glowA} stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="glowB" cx="88%" cy="78%" rx="80%" ry="55%">
          <Stop offset="0" stopColor={p.glowB} stopOpacity="0.30" />
          <Stop offset="1" stopColor={p.glowB} stopOpacity="0" />
        </RadialGradient>
        {/* Darkens the lower half so the figures stay legible over the glow. */}
        <LinearGradient id="vignette" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#000" stopOpacity="0" />
          <Stop offset="0.55" stopColor="#000" stopOpacity="0.18" />
          <Stop offset="1" stopColor="#000" stopOpacity="0.55" />
        </LinearGradient>
      </Defs>

      <Rect width={width} height={height} fill={p.base} />
      <Rect width={width} height={height} fill="url(#glowA)" />
      <Rect width={width} height={height} fill="url(#glowB)" />

      {/* Oversized, mostly off-canvas rings — the icon's motif used as texture. */}
      <Circle
        cx={width * 0.86}
        cy={height * 0.2}
        r={width * 0.52}
        stroke={p.ring}
        strokeOpacity={0.13}
        strokeWidth={1.5}
        fill="none"
      />
      <Circle
        cx={width * 0.1}
        cy={height * 0.84}
        r={width * 0.46}
        stroke={p.ring}
        strokeOpacity={0.1}
        strokeWidth={1.5}
        fill="none"
      />

      <Rect width={width} height={height} fill="url(#vignette)" />
    </Svg>
  );
}
