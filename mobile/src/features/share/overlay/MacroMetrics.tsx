import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/theme';
import { overlayShadow } from './shadow';

/**
 * Protein, carbs and fat as three light rows.
 *
 * Rows rather than the card's three tiles: a tile is a box, and at overlay
 * scale three boxes stacked down the left edge would be a panel by another
 * name. A value, a name and a hairline is the least furniture that still reads
 * as a group.
 *
 * Each row draws a bar only when that macro has a target. Protein usually does
 * and carbs and fat often do not, so the rows are deliberately fine with being
 * uneven — an invented denominator would be worse than a missing bar.
 */

export interface Macro {
  label: string;
  grams: number;
  goal?: number | null;
}

export function MacroMetrics({ w, macros }: { w: number; macros: Macro[] }) {
  return (
    <View style={{ width: w * 0.42 }}>
      <Text style={[styles.heading, { fontSize: w * 0.028 }]}>MACROS</Text>
      {macros.map((m) => {
        const pct = m.goal ? Math.max(0, Math.min(1, m.grams / m.goal)) : null;
        return (
          <View key={m.label} style={{ marginTop: w * 0.022 }}>
            <Text style={[styles.row, { fontSize: w * 0.038 }]}>
              <Text style={styles.grams}>{Math.round(m.grams)}g</Text>
              <Text style={styles.name}>{`  ${m.label}`}</Text>
            </Text>
            {pct !== null ? (
              <View style={[styles.track, { height: w * 0.008, marginTop: w * 0.008 }]}>
                <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: colors.accent }} />
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    color: colors.accent,
    fontFamily: fonts.bold,
    letterSpacing: 2.4,
    ...overlayShadow,
  },
  row: { ...overlayShadow },
  grams: { color: colors.text, fontFamily: fonts.bold },
  name: { color: 'rgba(255,255,255,0.72)', fontFamily: fonts.semibold },
  track: {
    width: '86%',
    backgroundColor: 'rgba(255,255,255,0.28)',
    borderRadius: 999,
    overflow: 'hidden',
  },
});
