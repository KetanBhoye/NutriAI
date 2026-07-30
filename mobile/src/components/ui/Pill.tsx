import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, type } from '@/theme';

interface PillOption<T extends string> {
  value: T;
  label: string;
  tag?: string;
  /**
   * The option currently in force (e.g. the pace the saved plan implies).
   * Marked faintly rather than selected: the editor starts with nothing
   * chosen, so this shows where you stand without choosing for you.
   */
  current?: boolean;
}

interface PillGroupProps<T extends string> {
  options: PillOption<T>[];
  value: T | null | undefined;
  onChange: (value: T) => void;
  columns?: number;
}

export function PillGroup<T extends string>({ options, value, onChange, columns = 2 }: PillGroupProps<T>) {
  return (
    <View style={styles.row}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={opt.current ? `${opt.label} (current)` : opt.label}
            style={[
              styles.pill,
              { flexBasis: `${100 / columns - 2}%` },
              opt.current && !active && styles.current,
              active && styles.active,
            ]}
          >
            <Text style={[styles.label, active && styles.activeLabel]}>{opt.label}</Text>
            {opt.tag ? <Text style={styles.tag}>{opt.tag}</Text> : null}
            {opt.current && !active ? <Text style={styles.currentTag}>current</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius - 2,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  active: { borderColor: colors.accent, backgroundColor: 'rgba(74,222,128,0.08)' },
  /**
   * Deliberately fainter than `active` — this is information, not a choice.
   * Solid, not dashed: RN can't render a dashed border with a corner radius and
   * warns "Unsupported dashed / dotted border style" on both platforms.
   */
  current: { borderColor: colors.accentDim, backgroundColor: 'rgba(34,197,94,0.04)' },
  currentTag: { ...type.caption, fontSize: 9.5, lineHeight: 12, color: colors.accentDim, marginTop: 1 },
  label: { ...type.subheading, fontSize: 14, color: colors.text },
  activeLabel: { color: colors.accent },
  tag: { ...type.caption, fontSize: 10, lineHeight: 13, color: colors.textDim, marginTop: 2 },
});
