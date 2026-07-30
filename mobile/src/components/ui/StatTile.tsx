import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius, type } from '@/theme';

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
  /**
   * No `lineHeight` here, deliberately — not `type.caption`.
   *
   * This span sits *inside* the value's `<Text>`, and Android sizes the line
   * box from the nested span's line height, then crops anything taller: the
   * 22px digits lost their tops, so `71.2` read as `/1.2` and `0.0` as `U.U`.
   * The targets card never showed it because its unit style sets no line
   * height either. Keep it that way.
   */
  unit: { fontFamily: fonts.regular, fontSize: 13, color: colors.textDim },
});
