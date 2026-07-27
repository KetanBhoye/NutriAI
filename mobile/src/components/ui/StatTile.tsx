import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, type } from '@/theme';

interface StatTileProps {
  label: string;
  value: string;
  unit?: string;
  color?: string;
  stripe?: string;
}

export function StatTile({ label, value, unit, color, stripe }: StatTileProps) {
  return (
    <View style={[styles.tile, stripe ? { borderLeftColor: stripe, borderLeftWidth: 3 } : null]}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, color ? { color } : null]}>
        {value}
        {unit ? <Text style={styles.unit}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexGrow: 1,
    flexBasis: '47%',
    backgroundColor: colors.surface,
    borderRadius: radius - 2,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: { ...type.overline, color: colors.textDim },
  value: { ...type.figure, color: colors.text, marginTop: 6 },
  unit: { ...type.caption, color: colors.textDim },
});
