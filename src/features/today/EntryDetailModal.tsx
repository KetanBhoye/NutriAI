import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, PillGroup, Sheet, TextField } from '@/components/ui';
import { capitalize } from '@/format';
import { AmountStepper } from './AmountStepper';
import { formatGrams, portionBasis, toGrams } from '@/portion';
import { colors, fonts, radius } from '@/theme';
import { FoodEntry, MealType } from '@/types';

const MEALS: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

interface EntryDetailModalProps {
  entry: FoodEntry | null;
  onClose: () => void;
  /**
   * Only the fields that actually changed shape are sent. A macro left blank is
   * omitted rather than sent as `null` — `PATCH /api/entries/:id` validates
   * each field as a number, so a null rejected the whole update with a 400 and
   * the edit silently disappeared on the next refresh.
   */
  onSave: (changes: {
    food_name: string;
    calories: number;
    protein_g?: number | null;
    carbs_g?: number | null;
    fat_g?: number | null;
    meal_type: MealType;
    quantity?: number;
    unit?: string;
  }) => void;
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

  /**
   * A filled field is sent as a number; a blank one is only sent (as null, to
   * clear it) when the entry had a value there to begin with. Otherwise it's
   * left out entirely, so an entry logged without macros doesn't turn every
   * edit into a payload the API rejects.
   */
  const macro = (text: string, original: number | null | undefined) => {
    if (text.trim()) {
      const n = Number(text);
      return Number.isFinite(n) ? n : undefined;
    }
    return original != null ? null : undefined;
  };

  const save = () => {
    const calories = Number(form.calories);
    if (!form.name.trim() || !Number.isFinite(calories)) return;
    onSave({
      food_name: form.name.trim(),
      calories: Math.round(calories),
      protein_g: macro(form.protein, entry.protein_g),
      carbs_g: macro(form.carbs, entry.carbs_g),
      fat_g: macro(form.fat, entry.fat_g),
      meal_type: form.meal,
      // Saving the weight too, so the next edit scales from the real portion
      // rather than re-estimating it. The API requires a positive quantity, so
      // a weight we couldn't work out is left out rather than sent as 0.
      ...(grams > 0 ? { quantity: grams, unit: 'g' } : {}),
    });
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
          <TextField label="Name" value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} />
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
