import { StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import { colors, radius, type } from '@/theme';

interface TextFieldProps extends TextInputProps {
  label?: string;
  /** Sizes/positions the field itself (e.g. `flex: 1` in a row) — the wrapping container, not the input's own look. */
  style?: ViewStyle;
}

export function TextField({ label, style, ...props }: TextFieldProps) {
  return (
    <View style={[styles.wrap, style]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput placeholderTextColor={colors.textDim} style={styles.input} {...props} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 12 },
  label: { ...type.caption, color: colors.textDim, marginBottom: 6 },
  input: {
    backgroundColor: colors.surface2,
    borderRadius: radius,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: colors.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
