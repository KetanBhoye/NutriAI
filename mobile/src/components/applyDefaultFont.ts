import { Text, TextInput } from 'react-native';
import { fonts } from '@/theme';

/**
 * Makes Inter the default family for every `<Text>`/`<TextInput>`.
 *
 * Without this, only styles that name a `fontFamily` get Inter and everything
 * else falls back to the OS font, so the app renders in two typefaces at once.
 *
 * `defaultProps` can't do this: it only applies when `style` is undefined, so
 * any element with its own style would lose the default. Wrapping `render`
 * instead prepends the default to the style array, which keeps explicit styles
 * winning.
 */
let applied = false;

export function applyDefaultFont(): void {
  if (applied) return;
  applied = true;

  for (const Component of [Text, TextInput] as const) {
    const target = Component as unknown as {
      render?: (props: Record<string, unknown>, ref: unknown) => unknown;
    };
    const original = target.render;
    if (typeof original !== 'function') continue;

    target.render = function patched(props, ref) {
      return original.call(this, { ...props, style: [{ fontFamily: fonts.regular }, props.style] }, ref);
    };
  }
}
