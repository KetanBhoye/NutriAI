import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, PillGroup, Sheet, TextField } from '@/components/ui';
import { capitalize } from '@/format';
import { AmountStepper } from './AmountStepper';
import { colors, fonts, radius } from '@/theme';
import { FoodEntry, MealType } from '@/types';

const MEALS: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

interface EntryDetailModalProps {
  entry: FoodEntry | null;
  onClose: () => void;
  onSave: (changes: {
    food_name: string;
    calories: number;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
    meal_type: MealType;
  }) => void;
  onDelete: () => void;
}

export function EntryDetailModal({ entry, onClose, onSave, onDelete }: EntryDetailModalProps) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [form, setForm] = useState({ name: '', calories: '', protein: '', carbs: '', fat: '', meal: 'snack' as MealType });
  const [qty, setQty] = useState(1);
  /**
   * Macros per single unit, derived when the sheet opens. Entries store totals,
   * not per-unit figures, so this is the only way to rescale them. Entries with
   * no recorded quantity (manual and AI-logged rows) are treated as one
   * serving, which still lets you double or halve them.
   */
  const [perUnit, setPerUnit] = useState({ calories: 0, protein: 0, carbs: 0, fat: 0 });

  useEffect(() => {
    if (!entry) return;
    setEditing(false);
    setConfirmingDelete(false);
    setForm({
      name: entry.food_name,
      calories: String(entry.calories),
      protein: entry.protein_g != null ? String(entry.protein_g) : '',
      carbs: entry.carbs_g != null ? String(entry.carbs_g) : '',
      fat: entry.fat_g != null ? String(entry.fat_g) : '',
      meal: entry.meal_type ?? 'snack',
    });

    const basis = entry.quantity && entry.quantity > 0 ? entry.quantity : 1;
    setQty(basis);
    setPerUnit({
      calories: entry.calories / basis,
      protein: (entry.protein_g ?? 0) / basis,
      carbs: (entry.carbs_g ?? 0) / basis,
      fat: (entry.fat_g ?? 0) / basis,
    });
  }, [entry]);

  if (!entry) return null;

  /** Rescales every macro field off the per-unit basis. */
  const changeQty = (next: number) => {
    setQty(next);
    setForm((f) => ({
      ...f,
      calories: String(Math.round(perUnit.calories * next)),
      protein: perUnit.protein ? String(Math.round(perUnit.protein * next)) : f.protein,
      carbs: perUnit.carbs ? String(Math.round(perUnit.carbs * next)) : f.carbs,
      fat: perUnit.fat ? String(Math.round(perUnit.fat * next)) : f.fat,
    }));
  };

  const save = () => {
    const calories = Number(form.calories);
    if (!form.name.trim() || !Number.isFinite(calories)) return;
    onSave({
      food_name: form.name.trim(),
      calories: Math.round(calories),
      protein_g: form.protein ? Number(form.protein) : null,
      carbs_g: form.carbs ? Number(form.carbs) : null,
      fat_g: form.fat ? Number(form.fat) : null,
      meal_type: form.meal,
    });
  };

  return (
    <Sheet visible={!!entry} onClose={onClose} title={editing ? 'Edit entry' : 'Entry'}>
      {!editing ? (
        <View>
          <Text style={styles.name}>{entry.food_name}</Text>
          <Text style={styles.meta}>
            {entry.meal_type}
            {entry.quantity && entry.unit ? ` · ${entry.quantity}${entry.unit}` : ''} · {entry.entry_date}
          </Text>

          <View style={styles.macroGrid}>
            <MacroCell value={String(entry.calories)} label="kcal" />
            <MacroCell value={entry.protein_g != null ? String(entry.protein_g) : '—'} label="protein" />
            <MacroCell value={entry.carbs_g != null ? String(entry.carbs_g) : '—'} label="carbs" />
            <MacroCell value={entry.fat_g != null ? String(entry.fat_g) : '—'} label="fat" />
          </View>

          {!confirmingDelete ? (
            <View style={styles.row}>
              <Button title="Edit" variant="ghost" onPress={() => setEditing(true)} style={styles.flex1} />
              <Button title="Delete" variant="danger" onPress={() => setConfirmingDelete(true)} style={styles.flex1} />
            </View>
          ) : (
            <View style={styles.confirmBox}>
              <Text style={styles.confirmText}>Delete this entry? This can't be undone.</Text>
              <View style={styles.row}>
                <Button title="Keep" variant="ghost" onPress={() => setConfirmingDelete(false)} style={styles.flex1} />
                <Button title="Delete" variant="danger" onPress={onDelete} style={styles.flex1} />
              </View>
            </View>
          )}
        </View>
      ) : (
        <View>
          <TextField label="Name" value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} />
          <Text style={styles.fieldLabel}>Amount</Text>
          <View style={styles.amount}>
            <AmountStepper quantity={qty} unit={entry.unit ?? 'serving'} onChange={changeQty} />
          </View>

          <Text style={styles.fieldLabel}>Meal</Text>
          <View style={styles.mealRow}>
            <PillGroup
              columns={4}
              options={MEALS.map((m) => ({ value: m, label: capitalize(m) }))}
              value={form.meal}
              onChange={(m) => setForm((f) => ({ ...f, meal: m }))}
            />
          </View>
          <View style={styles.grid2}>
            <TextField
              label="Calories"
              keyboardType="numeric"
              style={styles.half}
              value={form.calories}
              onChangeText={(v) => setForm((f) => ({ ...f, calories: v }))}
            />
            <TextField
              label="Protein (g)"
              keyboardType="numeric"
              style={styles.half}
              value={form.protein}
              onChangeText={(v) => setForm((f) => ({ ...f, protein: v }))}
            />
          </View>
          <View style={styles.grid2}>
            <TextField
              label="Carbs (g)"
              keyboardType="numeric"
              style={styles.half}
              value={form.carbs}
              onChangeText={(v) => setForm((f) => ({ ...f, carbs: v }))}
            />
            <TextField
              label="Fat (g)"
              keyboardType="numeric"
              style={styles.half}
              value={form.fat}
              onChangeText={(v) => setForm((f) => ({ ...f, fat: v }))}
            />
          </View>
          <View style={styles.row}>
            <Button title="Cancel" variant="ghost" onPress={() => setEditing(false)} style={styles.flex1} />
            <Button title="Save" onPress={save} style={styles.flex2} />
          </View>
        </View>
      )}
    </Sheet>
  );
}

function MacroCell({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.macroCell}>
      <Text style={styles.macroValue}>{value}</Text>
      <Text style={styles.macroLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  name: { color: colors.text, fontSize: 18, fontFamily: fonts.extrabold, marginBottom: 4 },
  meta: { color: colors.textDim, fontSize: 13, marginBottom: 16, textTransform: 'capitalize' },
  macroGrid: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  macroCell: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius - 2,
    paddingVertical: 12,
    alignItems: 'center',
  },
  macroValue: { color: colors.text, fontSize: 18, fontFamily: fonts.bold },
  macroLabel: { color: colors.textDim, fontSize: 11, marginTop: 2 },
  row: { flexDirection: 'row', gap: 10 },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
  confirmBox: { backgroundColor: colors.surface2, borderRadius: radius - 2, padding: 14, marginTop: 4 },
  confirmText: { color: colors.text, fontSize: 14, marginBottom: 12 },
  fieldLabel: { color: colors.textDim, fontSize: 12, marginBottom: 6 },
  amount: { marginBottom: 16 },
  mealRow: { marginBottom: 12 },
  grid2: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
});
