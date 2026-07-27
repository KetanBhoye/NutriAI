import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, tap, type } from '@/theme';

interface OptionRowProps {
  title: string;
  hint?: string;
  /** Right-aligned figure, e.g. the calorie target a goal implies. */
  value?: string;
  selected: boolean;
  onPress: () => void;
}

/**
 * A full-width, tappable choice in a stacked list — title on the left, an
 * optional figure on the right, and a hint underneath. Used where the options
 * carry too much text for a `PillGroup` (activity levels, goals).
 */
export function OptionRow({ title, hint, value, selected, onPress }: OptionRowProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.row, selected && styles.selected, pressed && styles.pressed]}
    >
      <View style={styles.head}>
        <Text style={[styles.title, selected && styles.titleSelected]}>{title}</Text>
        {value ? <Text style={[styles.value, selected && styles.valueSelected]}>{value}</Text> : null}
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: tap,
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    paddingVertical: 12,
    paddingHorizontal: 15,
    gap: 3,
  },
  selected: { borderColor: colors.accent, backgroundColor: 'rgba(74,222,128,0.06)' },
  pressed: { opacity: 0.85 },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  title: { ...type.subheading, color: colors.text, flexShrink: 1 },
  titleSelected: { color: colors.accent },
  value: { ...type.figureSmall, fontSize: 15, color: colors.textDim },
  valueSelected: { color: colors.accent },
  hint: { ...type.caption, color: colors.textDim },
});
