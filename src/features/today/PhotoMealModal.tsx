import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import { aiApi, entriesApi } from '@/api';
import { PhotoItem } from '@/api/ai';
import { Button, Loading, Sheet, TextField } from '@/components/ui';
import { colors, radius, type } from '@/theme';
import { MealType } from '@/types';
import { capitalize } from '@/format';

const MEALS: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];
/** Long edge the photo is downscaled to before upload — keeps the request small
 *  without losing the detail the model needs to identify food. */
const MAX_EDGE = 1024;

interface PhotoMealModalProps {
  /** Local URI of the captured/picked image; null closes the sheet. */
  uri: string | null;
  date: string;
  defaultMeal: MealType;
  onClose: () => void;
  onLogged: () => void;
}

type Status = 'analyzing' | 'review' | 'error';

export function PhotoMealModal({ uri, date, defaultMeal, onClose, onLogged }: PhotoMealModalProps) {
  const [status, setStatus] = useState<Status>('analyzing');
  const [note, setNote] = useState<string | null>(null);
  const [items, setItems] = useState<PhotoItem[]>([]);
  const [meal, setMeal] = useState<MealType>(defaultMeal);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uri) return;
    let cancelled = false;

    setStatus('analyzing');
    setError(null);
    setMeal(defaultMeal);

    (async () => {
      try {
        const shrunk = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: MAX_EDGE } }], {
          compress: 0.7,
          format: ImageManipulator.SaveFormat.JPEG,
          base64: true,
        });
        if (cancelled) return;
        if (!shrunk.base64) throw new Error('Could not read the photo.');

        const res = await aiApi.parseMealPhoto(`data:image/jpeg;base64,${shrunk.base64}`);
        if (cancelled) return;

        setNote(res.note);
        setItems(res.items ?? []);
        setStatus(res.items?.length ? 'review' : 'error');
        if (!res.items?.length) {
          setError(res.note ?? "Couldn't identify any food in that photo.");
        }
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message || 'Could not analyse that photo.');
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [uri, defaultMeal]);

  const patch = (index: number, changes: Partial<PhotoItem>) =>
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...changes } : it)));

  const total = items.reduce((sum, it) => sum + (Number(it.calories) || 0), 0);

  const logAll = async () => {
    setSaving(true);
    setError(null);
    try {
      // Sequential rather than parallel: the backend resolves each entry
      // against the food library, and concurrent writes can create duplicates.
      for (const it of items) {
        await entriesApi.createEntry({
          food_name: it.food_name,
          calories: Math.round(Number(it.calories) || 0),
          protein_g: it.protein_g ?? undefined,
          carbs_g: it.carbs_g ?? undefined,
          fat_g: it.fat_g ?? undefined,
          meal_type: meal,
          entry_date: date,
        });
      }
      onLogged();
      onClose();
    } catch {
      setError("Couldn't save those entries. Check your connection.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible={!!uri} onClose={onClose} title="Snap a meal">
      {uri ? <Image source={{ uri }} style={styles.preview} resizeMode="cover" /> : null}

      {status === 'analyzing' ? (
        <Loading label="Reading your plate…" />
      ) : status === 'error' ? (
        <View>
          <Text style={styles.error}>{error}</Text>
          <Button title="Close" variant="ghost" onPress={onClose} style={{ marginTop: 12 }} />
        </View>
      ) : (
        <View>
          {note ? <Text style={styles.note}>{note}</Text> : null}

          <Text style={styles.label}>Meal</Text>
          <View style={styles.mealRow}>
            {MEALS.map((m) => (
              <Pressable
                key={m}
                onPress={() => setMeal(m)}
                style={[styles.mealPill, meal === m && styles.mealPillActive]}
              >
                <Text style={[styles.mealText, meal === m && styles.mealTextActive]}>{capitalize(m)}</Text>
              </Pressable>
            ))}
          </View>

          {items.map((it, i) => (
            <View key={i} style={styles.item}>
              <TextField
                value={it.food_name}
                onChangeText={(v) => patch(i, { food_name: v })}
                style={styles.itemName}
              />
              <View style={styles.itemRow}>
                <TextField
                  label="kcal"
                  keyboardType="number-pad"
                  style={styles.itemField}
                  value={String(it.calories ?? '')}
                  onChangeText={(v) => patch(i, { calories: Number(v) || 0 })}
                />
                <TextField
                  label="Protein"
                  keyboardType="number-pad"
                  style={styles.itemField}
                  value={it.protein_g != null ? String(it.protein_g) : ''}
                  onChangeText={(v) => patch(i, { protein_g: v ? Number(v) : null })}
                />
                <Pressable
                  onPress={() => setItems((prev) => prev.filter((_, n) => n !== i))}
                  hitSlop={10}
                  style={styles.remove}
                >
                  <Text style={styles.removeText}>×</Text>
                </Pressable>
              </View>
            </View>
          ))}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button
            title={saving ? 'Logging…' : `Log ${items.length} item${items.length === 1 ? '' : 's'} · ${Math.round(total)} kcal`}
            onPress={logAll}
            disabled={saving || items.length === 0}
            style={{ marginTop: 8 }}
          />
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  preview: { width: '100%', height: 150, borderRadius: radius, marginBottom: 14, backgroundColor: colors.surface2 },
  note: { ...type.caption, color: colors.textDim, marginBottom: 14 },
  label: { ...type.caption, color: colors.textDim, marginBottom: 6 },
  mealRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  mealPill: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius - 4,
  },
  mealPillActive: { borderColor: colors.accent, backgroundColor: 'rgba(74,222,128,0.08)' },
  mealText: { ...type.caption, color: colors.text },
  mealTextActive: { color: colors.accent },
  item: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius - 2,
    padding: 12,
    marginBottom: 10,
  },
  itemName: { marginBottom: 8 },
  itemRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  itemField: { flex: 1, marginBottom: 0 },
  remove: { width: 34, height: 46, alignItems: 'center', justifyContent: 'center' },
  removeText: { color: colors.textDim, fontSize: 22 },
  error: { ...type.caption, color: colors.danger, marginTop: 10 },
});
