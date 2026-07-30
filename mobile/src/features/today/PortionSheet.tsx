import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Sheet } from '@/components/ui';
import { colors, radius, type } from '@/theme';
import { formatGrams, portionBasis } from '@/portion';
import { Suggestion } from '@/types';
import { AmountStepper } from './AmountStepper';

interface PortionSheetProps {
  food: Suggestion | null;
  /** Grams to log, plus the macros for that weight. */
  onConfirm: (portion: { grams: number; calories: number; protein_g: number | null; carbs_g: number | null; fat_g: number | null }) => void;
  onCancel: () => void;
}

export function PortionSheet({ food, onConfirm, onCancel }: PortionSheetProps) {
  const [grams, setGrams] = useState(100);
  const [estimated, setEstimated] = useState(false);
  const [perGram, setPerGram] = useState({ calories: 0, protein: 0, carbs: 0, fat: 0 });

  useEffect(() => {
    if (!food) return;
    // The library quotes macros per reference unit; convert that unit's default
    // portion to grams so the stepper works in the one unit that always scales.
    const q = food.default_quantity || 1;
    const totals = {
      calories: food.calories_per_unit * q,
      protein_g: (food.protein_g_per_unit ?? 0) * q,
      carbs_g: (food.carbs_g_per_unit ?? 0) * q,
      fat_g: (food.fat_g_per_unit ?? 0) * q,
    };
    const basis = portionBasis(totals, q, food.reference_unit);
    setGrams(basis.grams);
    setEstimated(!basis.exact);
    setPerGram({
      calories: totals.calories / basis.grams,
      protein: totals.protein_g / basis.grams,
      carbs: totals.carbs_g / basis.grams,
      fat: totals.fat_g / basis.grams,
    });
  }, [food]);

  if (!food) return null;

  const at = (perUnit: number, present: boolean) => (present ? Math.round(perUnit * grams) : null);
  const kcal = Math.round(perGram.calories * grams);

  return (
    <Sheet visible={!!food} onClose={onCancel} title="Portion">
      <Text style={styles.name}>{food.canonical_name}</Text>

      <View style={styles.stepper}>
        <AmountStepper
          grams={grams}
          onChange={setGrams}
          hint={
            estimated
              ? `Usual portion is about ${formatGrams(grams)} — tap the number to set an exact weight.`
              : undefined
          }
        />
      </View>

      <View style={styles.macros}>
        <Macro label="kcal" value={kcal} />
        <Macro label="Protein" value={at(perGram.protein, food.protein_g_per_unit != null)} unit="g" />
        <Macro label="Carbs" value={at(perGram.carbs, food.carbs_g_per_unit != null)} unit="g" />
        <Macro label="Fat" value={at(perGram.fat, food.fat_g_per_unit != null)} unit="g" />
      </View>

      <Button
        title={`Log ${formatGrams(grams)} · ${kcal} kcal`}
        onPress={() =>
          onConfirm({
            grams,
            calories: kcal,
            protein_g: at(perGram.protein, food.protein_g_per_unit != null),
            carbs_g: at(perGram.carbs, food.carbs_g_per_unit != null),
            fat_g: at(perGram.fat, food.fat_g_per_unit != null),
          })
        }
        disabled={grams <= 0}
      />
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
  stepper: { marginBottom: 20 },
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
