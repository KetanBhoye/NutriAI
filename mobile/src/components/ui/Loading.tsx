import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors, type } from '@/theme';

/** Centred spinner with an optional caption, for in-progress screen sections. */
export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.wrap}>
      <ActivityIndicator color={colors.accent} />
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 32, gap: 12 },
  label: { ...type.body, color: colors.textDim },
});
