import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, PillGroup, Sheet, TextField } from '@/components/ui';
import { capitalize } from '@/format';
import { AmountStepper } from './AmountStepper';
import { buildEntryChanges, type EntryChanges } from './entryChanges';
import { formatGrams, portionBasis, toGrams } from '@/portion';
import { colors, fonts, radius } from '@/theme';
import { FoodEntry, MealType } from '@/types';

const MEALS: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

interface EntryDetailModalProps {
  entry: FoodEntry | null;
  onClose: () => void;
  /** See `entryChanges.ts` for which fields are sent, omitted or cleared. */
  onSave: (changes: EntryChanges) => void;
  onDelete: () => void;
}

export function EntryDetailModal({ entry, onClose, onSave, onDelete }: EntryDetailModalProps) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [form, setForm] = useState({ name: '', calories: '', protein: '', carbs: '', fat: '', meal: 'snack' as MealType });
  const [grams, setGrams] = useState(100);
  const [estimated, setEstimated] = useState(false);
  /**
   * Macros per gram, derived when the sheet opens. Entries store totals, not
   * per-unit figures, so this is the only way to rescale them. Rows logged
   * before grams were recorded get a weight estimated from their macros.
   */
  const [perGram, setPerGram] = useState({ calories: 0, protein: 0, carbs: 0, fat: 0 });

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

    const basis = portionBasis(entry, entry.quantity, entry.unit);
    setGrams(basis.grams);
    setEstimated(!basis.exact);
    setPerGram({
      calories: entry.calories / basis.grams,
      protein: (entry.protein_g ?? 0) / basis.grams,
      carbs: (entry.carbs_g ?? 0) / basis.grams,
      fat: (entry.fat_g ?? 0) / basis.grams,
    });
  }, [entry]);

  if (!entry) return null;

  const recordedGrams = toGrams(entry.quantity, entry.unit);

  /** Rescales every macro field off the per-gram basis. */
  const changeGrams = (next: number) => {
    setGrams(next);
    setForm((f) => ({
      ...f,
      calories: String(Math.round(perGram.calories * next)),
      protein: perGram.protein ? String(Math.round(perGram.protein * next)) : f.protein,
      carbs: perGram.carbs ? String(Math.round(perGram.carbs * next)) : f.carbs,
      fat: perGram.fat ? String(Math.round(perGram.fat * next)) : f.fat,
    }));
  };

  const save = () => {
    // The payload rules live in entryChanges.ts, where they're under test.
    const changes = buildEntryChanges(form, entry, grams);
    if (changes) onSave(changes);
  };

  return (
    <Sheet visible={!!entry} onClose={onClose} title={editing ? 'Edit entry' : 'Entry'}>
      {!editing ? (
        <View>
          <Text style={styles.name}>{entry.food_name}</Text>
          <Text style={styles.meta}>
            {entry.meal_type}
            {recordedGrams != null ? ` · ${formatGrams(recordedGrams)}` : ''} · {entry.entry_date}
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
          <TextField testID="entry-name" label="Name" value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} />
          <Text style={styles.fieldLabel}>Amount</Text>
          <View style={styles.amount}>
            <AmountStepper
              grams={grams}
              onChange={changeGrams}
              hint={estimated ? 'Weight estimated from the macros — correct it and they rescale.' : undefined}
            />
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
              testID="entry-calories"
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
