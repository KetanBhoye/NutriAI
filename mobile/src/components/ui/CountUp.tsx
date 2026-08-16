import { useEffect, useRef, useState } from 'react';
import { Text, TextStyle } from 'react-native';

/**
 * A number that counts to its value.
 *
 * Used for the day's calorie total, which is the one figure people look at
 * every time they open the app. Animating it does something a static number
 * cannot: after logging a meal you *see* the total move, and the size of the
 * move is the feedback.
 *
 * Driven from JS rather than the native driver, because there is no way to
 * animate text content natively — so it is deliberately short, and used on
 * exactly one figure per screen. Running this on every macro would put a
 * setState on every frame for numbers nobody is watching.
 */
export function CountUp({
  value,
  duration = 550,
  style,
  format = (n: number) => String(Math.round(n)),
}: {
  value: number;
  duration?: number;
  style?: TextStyle | TextStyle[];
  format?: (n: number) => string;
}) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const start = Date.now();
    const origin = from.current;
    const delta = value - origin;

    // Nothing to animate — and skipping avoids a pointless frame loop on
    // every re-render of the parent.
    if (delta === 0) {
      setShown(value);
      return;
    }

    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / duration);
      // Ease-out: fast to most of the value, then settle. A linear count
      // reads like a slot machine.
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(origin + delta * eased);
      if (t < 1) {
        frame.current = requestAnimationFrame(tick);
      } else {
        from.current = value;
      }
    };

    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      // Leave the final value behind, so an interrupted count never strands
      // the UI on a number that was only ever a frame in an animation.
      from.current = value;
    };
  }, [value, duration]);

  return <Text style={style}>{format(shown)}</Text>;
}
