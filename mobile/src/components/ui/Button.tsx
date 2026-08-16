import { useCallback, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, radius, tap, type } from '@/theme';
import { NutriLoader } from './NutriLoader';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  style?: ViewStyle;
}

export function Button({ title, onPress, variant = 'primary', disabled, busy, style }: ButtonProps) {
  const isDisabled = disabled || busy;

  /**
   * A press dips the button and springs it back.
   *
   * The scale lives on a wrapping `Animated.View`, **not** on an animated
   * Pressable. `Animated.createAnimatedComponent(Pressable)` passes a
   * function `style` through without resolving it, so the variant styles
   * never applied: the primary button lost its green fill and its minimum
   * height, leaving dark text on a dark background in a collapsed row. The
   * pressed state has to stay on a plain Pressable for that callback to work.
   *
   * Native driver, because the press handler is usually doing work — logging
   * a food, saving a plan — and feedback that arrives after it feels worse
   * than none.
   */
  const scale = useRef(new Animated.Value(1)).current;
  const to = useCallback(
    (value: number) =>
      Animated.timing(scale, {
        toValue: value,
        duration: value < 1 ? 90 : 140,
        easing: value < 1 ? Easing.out(Easing.quad) : Easing.out(Easing.back(2)),
        useNativeDriver: true,
      }).start(),
    [scale]
  );

  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <Pressable
        style={({ pressed }) => [
          styles.base,
          variant === 'primary' && styles.primary,
          variant === 'ghost' && styles.ghost,
          variant === 'danger' && styles.danger,
          (isDisabled || pressed) && styles.pressed,
        ]}
        onPressIn={() => {
          if (isDisabled) return;
          to(0.965);
          // Selection rather than impact: several of these a minute while
          // logging a meal, so it has to be a tick, not a thud.
          void Haptics.selectionAsync().catch(() => {});
        }}
        onPressOut={() => to(1)}
        onPress={onPress}
        disabled={isDisabled}
      >
        {busy ? (
          <NutriLoader size={22} bare />
        ) : (
          <Text
            style={[
              styles.text,
              variant === 'primary' && styles.primaryText,
              variant === 'ghost' && styles.ghostText,
              variant === 'danger' && styles.dangerText,
            ]}
          >
            {title}
          </Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius,
    minHeight: tap,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  primary: { backgroundColor: colors.accent },
  ghost: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  danger: { backgroundColor: 'rgba(248,113,113,0.12)', borderWidth: 1, borderColor: colors.danger },
  pressed: { opacity: 0.8 },
  text: { ...type.button },
  primaryText: { color: colors.onAccent },
  ghostText: { color: colors.text },
  dangerText: { color: colors.danger },
});
