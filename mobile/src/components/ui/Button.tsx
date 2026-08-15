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
   * A press dips the button slightly and taps back.
   *
   * Scale runs on the native driver so it stays smooth even while the press
   * handler is doing work — which for the primary buttons here (log a food,
   * save the plan) it usually is. Without that the feedback arrives late,
   * which feels worse than no feedback at all.
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
    <AnimatedPressable
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && styles.primary,
        variant === 'ghost' && styles.ghost,
        variant === 'danger' && styles.danger,
        (isDisabled || pressed) && styles.pressed,
        { transform: [{ scale }] },
        style,
      ]}
      onPressIn={() => {
        if (isDisabled) return;
        to(0.965);
        // Selection rather than impact: four of these a minute while logging
        // a meal, so it has to be a tick, not a thud.
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
    </AnimatedPressable>
  );
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

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
