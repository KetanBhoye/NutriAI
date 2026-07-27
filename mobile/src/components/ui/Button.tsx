import { ActivityIndicator, Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import { colors, radius, tap, type } from '@/theme';

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
  return (
    <Pressable
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && styles.primary,
        variant === 'ghost' && styles.ghost,
        variant === 'danger' && styles.danger,
        (isDisabled || pressed) && styles.pressed,
        style,
      ]}
      onPress={onPress}
      disabled={isDisabled}
    >
      {busy ? (
        <ActivityIndicator color={variant === 'ghost' ? colors.accent : colors.onAccent} />
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
