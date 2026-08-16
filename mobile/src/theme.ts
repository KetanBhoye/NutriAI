import { Platform, TextStyle } from 'react-native';

/**
 * Brand tokens ported from the web app's dark theme (web/src/style.css).
 * The web app is the source of truth for the product's look; this app
 * previously used a placeholder blue accent that never matched it.
 */
export const colors = {
  bg: '#0f1115',
  surface: '#171a21',
  surface2: '#1e222b',
  border: '#272c37',
  text: '#e8eaed',
  textDim: '#9aa2b1',
  accent: '#4ade80',
  accentDim: '#22c55e',
  warn: '#fbbf24',
  danger: '#f87171',
  cyan: '#5ad1ff',
  purple: '#a98bff',
  onAccent: '#06210f',
};

/**
 * The spacing scale.
 *
 * Everything vertical should be one of these. Before it existed, screens mixed
 * 6, 8, 12, 14, 16, 18, 20, 22, 24, 28, 30, 32 and 40 — which is why gaps that
 * were meant to look equal didn't, and why a component carrying its own margin
 * plus a parent's `gap` silently produced a third value nobody chose.
 *
 * Steps are 4-based: each is either +4 or a jump that reads as a new grouping
 * level, so two elements one step apart look related and two elements three
 * steps apart look separate.
 */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 44,
} as const;

export const radius = 14;
export const tap = 48;

/**
 * Inter, loaded in `app/_layout.tsx`. The OS default (SF Pro) is fine but
 * generic; Inter reads better at the small sizes this data-dense UI uses and
 * looks identical on both platforms.
 *
 * Weights are separate font files, so `fontWeight` does nothing — you must
 * pick the right family. Always go through `type` below rather than setting
 * `fontFamily`/`fontWeight` by hand.
 */
export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extrabold: 'Inter_800ExtraBold',
};

/**
 * Figures (calories, macros, weights) use lining tabular numerals so columns
 * line up and digits don't jitter as values change — this replaces the old
 * Menlo monospace, which looked out of place next to the UI text.
 */
const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

/** The app's type scale. Prefer these over ad-hoc size/weight pairs. */
export const type = {
  /** Screen titles, e.g. "Trends". */
  title: { fontFamily: fonts.extrabold, fontSize: 28, lineHeight: 34, letterSpacing: -0.5 } as TextStyle,
  /** Section headings within a screen. */
  heading: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 24, letterSpacing: -0.2 } as TextStyle,
  /** Card titles / list-row titles. */
  subheading: { fontFamily: fonts.semibold, fontSize: 15.5, lineHeight: 21 } as TextStyle,
  /** Default body copy. */
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 } as TextStyle,
  /** Secondary copy, hints, captions. */
  caption: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 } as TextStyle,
  /** Small uppercase eyebrow labels above a value or section. */
  overline: {
    fontFamily: fonts.medium,
    fontSize: 10.5,
    lineHeight: 14,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  } as TextStyle,
  /** Button labels. */
  button: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 20 } as TextStyle,
  /** A hero figure, e.g. the day's calorie total. */
  figureLarge: { fontFamily: fonts.extrabold, fontSize: 40, lineHeight: 44, letterSpacing: -1, ...tabular } as TextStyle,
  /** A stat-tile figure. */
  figure: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 27, letterSpacing: -0.3, ...tabular } as TextStyle,
  /** Inline numerals inside body text that should still align. */
  figureSmall: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, ...tabular } as TextStyle,
};

/**
 * True monospace, for opaque strings where character alignment aids reading —
 * i.e. the API token. Numeric UI should use `type.figure*` (tabular numerals)
 * instead, which stays in the UI typeface.
 */
export const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

export const statusColor: Record<'ahead' | 'on' | 'watch' | 'behind' | 'empty', string> = {
  ahead: colors.cyan,
  on: colors.accent,
  watch: colors.warn,
  behind: colors.danger,
  empty: colors.textDim,
};
