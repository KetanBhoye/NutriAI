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
/**
 * Day themes are warm — magenta, gold, green. Week themes are cool — violet,
 * indigo, teal. That split is deliberate and is the main thing keeping the two
 * cards apart in a feed: side by side they were previously the same object with
 * different numbers, because a shared palette beats any layout difference at
 * thumbnail size.
 */
export type CardTheme =
  | 'perfect'
  | 'streak'
  | 'weight'
  | 'protein'
  | 'steps'
  | 'dialed'
  | 'default'
  | 'week-best'
  | 'week-strong'
  | 'week-steady'
  | 'week-building';

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
  // The rarest card in the set — everything hit at once. Magenta into gold,
  // deliberately unlike the others so it reads as an event in a feed.
  perfect: { base: '#160c14', glowA: '#f472b6', glowB: '#fbbf24', ring: '#f472b6' },
  // Gold: rare, so it should feel like an award.
  streak: { base: '#15120c', glowA: '#fbbf24', glowB: '#f97316', ring: '#fbbf24' },
  // Indigo for the scale moving — calm, not celebratory; it's a trend, not a win.
  weight: { base: '#0c0f1a', glowA: '#818cf8', glowB: '#38bdf8', ring: '#818cf8' },
  // Brand green, pushed saturated.
  protein: { base: '#0c1510', glowA: '#4ade80', glowB: '#14b8a6', ring: '#4ade80' },
  // Cyan reads as motion/distance.
  steps: { base: '#0a1218', glowA: '#5ad1ff', glowB: '#4ade80', ring: '#5ad1ff' },
  // Calm green/teal for a day held in check.
  dialed: { base: '#0b1412', glowA: '#4ade80', glowB: '#5ad1ff', ring: '#4ade80' },
  // Muted violet so a plain day still looks considered.
  default: { base: '#0f1115', glowA: '#a98bff', glowB: '#5ad1ff', ring: '#a98bff' },

  // ── Week cards. Cool throughout, so a week never reads as a day. ──────────
  // Electric violet into cyan: the rarest week, and unmistakably not a day card.
  'week-best': { base: '#0d0a1c', glowA: '#8b5cf6', glowB: '#22d3ee', ring: '#a78bfa' },
  // Indigo into teal — confident, still calm.
  'week-strong': { base: '#0a0f1e', glowA: '#6366f1', glowB: '#2dd4bf', ring: '#818cf8' },
  // Slate blue: a solid week that isn't claiming to be a triumph.
  'week-steady': { base: '#0a0e18', glowA: '#3b82f6', glowB: '#38bdf8', ring: '#60a5fa' },
  // Deep blue-grey. Quiet on purpose — this is a week someone is still building.
  'week-building': { base: '#0b0d14', glowA: '#475569', glowB: '#38bdf8', ring: '#64748b' },
};

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
