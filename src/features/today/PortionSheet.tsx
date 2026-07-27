import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Sheet, TextField } from '@/components/ui';
import { colors, fonts, radius, type } from '@/theme';
import { Suggestion } from '@/types';
import { AmountStepper, formatQty, stepFor } from './AmountStepper';

interface PortionSheetProps {
  food: Suggestion | null;
  onConfirm: (quantity: number) => void;
  onCancel: () => void;
}

export function PortionSheet({ food, onConfirm, onCancel }: PortionSheetProps) {
  const [qty, setQty] = useState(1);

  const step = food ? stepFor(food.reference_unit) : 1;

  useEffect(() => {
    if (food) setQty(food.default_quantity || step);
  }, [food, step]);

  if (!food) return null;

  const scale = (per: number | null) => (per == null ? null : Math.round(per * qty));
  const kcal = Math.round(food.calories_per_unit * qty);

  return (
    <Sheet visible={!!food} onClose={onCancel} title="Portion">
      <Text style={styles.name}>{food.canonical_name}</Text>

      <View style={styles.stepper}>
        <AmountStepper quantity={qty} unit={food.reference_unit} onChange={setQty} />
      </View>

      {/* Typed entry for anything the stepper would take too long to reach. */}
      <TextField
        label="Or type an amount"
        keyboardType="decimal-pad"
        value={formatQty(qty, step)}
        onChangeText={(v) => setQty(Math.max(0, Number(v) || 0))}
      />

      <View style={styles.macros}>
        <Macro label="kcal" value={kcal} />
        <Macro label="Protein" value={scale(food.protein_g_per_unit)} unit="g" />
        <Macro label="Carbs" value={scale(food.carbs_g_per_unit)} unit="g" />
        <Macro label="Fat" value={scale(food.fat_g_per_unit)} unit="g" />
      </View>

      <Button title={`Log ${kcal} kcal`} onPress={() => onConfirm(qty)} disabled={qty <= 0} />
    </Sheet>
  );
}

function Macro({ label, value, unit }: { label: string; value: number | null; unit?: string }) {
  return (
    <View style={styles.macroCell}>
      <Text style={styles.macroValue}>
        {value ?? '—'}
        {value != null && unit ? unit : ''}
      </Text>
      <Text style={styles.macroLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  name: { ...type.subheading, color: colors.text, marginBottom: 18 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 18 },
  stepBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: { opacity: 0.7, borderColor: colors.accentDim },
  disabled: { opacity: 0.35 },
  stepText: { color: colors.text, fontFamily: fonts.semibold, fontSize: 26, lineHeight: 30 },
  qtyBox: { flex: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4 },
  qty: {
    color: colors.text,
    fontFamily: fonts.extrabold,
    fontSize: 40,
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  unit: { ...type.body, color: colors.textDim },
  macros: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  macroCell: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius - 2,
    paddingVertical: 12,
    alignItems: 'center',
  },
  macroValue: { ...type.figure, fontSize: 17, color: colors.text },
  macroLabel: { ...type.caption, fontSize: 11, color: colors.textDim, marginTop: 2 },
});
