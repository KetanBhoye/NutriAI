import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';

/**
 * The NutriAI mark: a macro ring closing around a leaf.
 *
 * The same artwork as the app icon and the loader — drawn from the same
 * geometry rather than imported as a PNG, so it stays sharp at any size and
 * cannot drift out of step with the icon when one of them is edited.
 *
 * `glow` is off by default. On the login screen it sits behind the mark as a
 * soft halo; inside a dense layout it would just muddy the edges.
 */
export function BrandMark({ size = 96 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 512 512">
      <Defs>
        <LinearGradient id="brandArc" x1="15%" y1="95%" x2="88%" y2="5%">
          <Stop offset="0%" stopColor="#166534" />
          <Stop offset="40%" stopColor="#22c55e" />
          <Stop offset="100%" stopColor="#bbf7d0" />
        </LinearGradient>
        <LinearGradient id="brandLeaf" x1="25%" y1="85%" x2="80%" y2="15%">
          <Stop offset="0%" stopColor="#34d399" />
          <Stop offset="100%" stopColor="#d1fae5" />
        </LinearGradient>
      </Defs>

      {/* the day not yet eaten */}
      <Circle cx="256" cy="256" r="150" fill="none" stroke="#18241d" strokeWidth="26" />
      {/* ~76% of a ring: progress, not a closed loop */}
      <Path
        d="M 256 106 A 150 150 0 1 1 150 362"
        fill="none"
        stroke="url(#brandArc)"
        strokeWidth="26"
        strokeLinecap="round"
      />
      <Path
        d="M 330 176 C 336 268 292 330 206 336 C 186 268 232 194 330 176 Z"
        fill="url(#brandLeaf)"
      />
    </Svg>
  );
}
