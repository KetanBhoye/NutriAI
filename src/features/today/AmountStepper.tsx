import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, fonts, type } from '@/theme';

/**
 * Step size per unit. Nudging grams by 1 would take forever, and nudging
 * "1 scoop" by 25 is nonsense — so the step follows what the unit measures.
 */
export function stepFor(unit: string | null | undefined): number {
  const u = (unit ?? '').toLowerCase();
  if (u === 'g' || u === 'ml') return 25;
  if (u === 'kg' || u === 'l') return 0.1;
  return 1; // scoop, piece, slice, can, serving…
}

/** Grams read oddly as "150.0"; scoops read oddly as "1.0". */
export function formatQty(q: number, step: number): string {
  return step < 1 ? q.toFixed(1) : String(Math.round(q));
}

/** Units that are quantities rather than counts, so the label reads naturally. */
export function unitLabel(unit: string | null | undefined): string {
  const u = (unit ?? 'serving').toLowerCase();
  return u === 'serving' ? '' : u;
}

interface AmountStepperProps {
  quantity: number;
  unit: string | null | undefined;
  onChange: (quantity: number) => void;
}

/** −/+ control with the amount and its unit, shared by the add and edit sheets. */
export function AmountStepper({ quantity, unit, onChange }: AmountStepperProps) {
  const step = stepFor(unit);
  const label = unitLabel(unit);

  const nudge = (delta: number) => {
    void Haptics.selectionAsync();
    // Snap to the step grid so repeated taps don't drift to 137.5g.
    onChange(Math.max(step, Math.round((quantity + delta) / step) * step));
  };

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => nudge(-step)}
        disabled={quantity <= step}
        style={({ pressed }) => [styles.btn, pressed && styles.pressed, quantity <= step && styles.disabled]}
      >
        <Text style={styles.btnText}>−</Text>
      </Pressable>

      <View style={styles.value}>
        <Text style={styles.qty}>{formatQty(quantity, step)}</Text>
        {label ? <Text style={styles.unit}>{label}</Text> : null}
      </View>

      <Pressable onPress={() => nudge(step)} style={({ pressed }) => [styles.btn, pressed && styles.pressed]}>
        <Text style={styles.btnText}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  btn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: { opacity: 0.7, borderColor: colors.accentDim },
  disabled: { opacity: 0.35 },
  btnText: { color: colors.text, fontFamily: fonts.semibold, fontSize: 24, lineHeight: 28 },
  value: { flex: 1, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 4 },
  qty: {
    color: colors.text,
    fontFamily: fonts.extrabold,
    fontSize: 36,
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  unit: { ...type.body, color: colors.textDim },
});
