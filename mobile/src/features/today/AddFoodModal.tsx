import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { entriesApi } from '@/api';
import { Button, Sheet, TextField } from '@/components/ui';
import { colors, radius } from '@/theme';
import { parseISODate } from '@/dates';
import { capitalize } from '@/format';
import { defaultPortion, formatGrams } from '@/portion';
import { MealType, Suggestion } from '@/types';

interface AddFoodModalProps {
  visible: boolean;
  meal: MealType;
  onClose: () => void;
  /** Log a suggestion at its default quantity. */
  onSelect: (suggestion: Suggestion) => void;
  /** Open the portion stepper for a suggestion instead of logging it. */
  onAdjust: (suggestion: Suggestion) => void;
  /** Log a free-form manual entry. */
  onManual: (input: {
    food_name: string;
    calories: number;
    protein_g?: number;
    carbs_g?: number;
    fat_g?: number;
    grams?: number;
  }) => void;
}

/** Strips an embedded portion like "(150g)" so it doesn't repeat the portion chip. */
function displayName(food: Suggestion): string {
  if (food.reference_unit === 'serving') return food.canonical_name;
  return (
    food.canonical_name
      .replace(/\(\s*~?\s*\d+(\.\d+)?\s*[a-z]*\s*\)/gi, '')
      .replace(/\b~?\d+(\.\d+)?\s*(g|ml|kg|scoops?|pcs?|pieces?|slices?|cans?)\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([,)])/g, '$1')
      .replace(/[\s(,-]+$/, '')
      .trim() || food.canonical_name
  );
}

function relativeDay(date: string | null): string {
  if (!date) return '';
  const days = Math.round((Date.now() - parseISODate(date).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.round(days / 7)}w ago`;
  return `${Math.round(days / 30)}mo ago`;
}

function macroLine(food: Suggestion): string {
  const p = defaultPortion(food);
  const protein = p.protein_g ? `${p.protein_g}g P` : null;
  return [`${formatGrams(p.grams)} · ${p.calories} kcal`, protein].filter(Boolean).join(' · ');
}

export function AddFoodModal({ visible, meal, onClose, onSelect, onAdjust, onManual }: AddFoodModalProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manual, setManual] = useState({ name: '', calories: '', protein: '', carbs: '', fat: '', grams: '' });
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setResults([]);
    setManualMode(false);
    setManual({ name: '', calories: '', protein: '', carbs: '', fat: '', grams: '' });
    setSuggestionsLoading(true);
    entriesApi
      .getSuggestions(meal)
      .then((d) => setSuggestions(d.suggestions))
      .catch(() => setSuggestions([]))
      .finally(() => setSuggestionsLoading(false));
  }, [visible, meal]);

  useEffect(() => {
    clearTimeout(searchTimer.current);
    if (query.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimer.current = setTimeout(() => {
      entriesApi
        .searchFoods(query.trim())
        .then((d) => setResults(d.foods))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(searchTimer.current);
  }, [query]);

  const openManual = () => {
    setManual((m) => ({ ...m, name: query.trim() }));
    setManualMode(true);
  };

  const submitManual = () => {
    const calories = Number(manual.calories);
    if (!manual.name.trim() || !Number.isFinite(calories) || calories < 0) return;
    onManual({
      food_name: manual.name.trim(),
      calories: Math.round(calories),
      protein_g: manual.protein ? Number(manual.protein) : undefined,
      carbs_g: manual.carbs ? Number(manual.carbs) : undefined,
      fat_g: manual.fat ? Number(manual.fat) : undefined,
      grams: manual.grams ? Number(manual.grams) : undefined,
    });
  };

  const searching2Plus = query.trim().length >= 2;
  const list = searching2Plus ? results : suggestions;
  const listLoading = searching2Plus ? searching : suggestionsLoading;

  return (
    <Sheet visible={visible} onClose={onClose} title={manualMode ? 'Add food' : capitalize(meal)}>
      {manualMode ? (
        <View>
          <TextField
            testID="manual-name"
            label="Name"
            value={manual.name}
            onChangeText={(v) => setManual((m) => ({ ...m, name: v }))}
          />
          <View style={styles.grid2}>
            <TextField
              testID="manual-grams"
              label="Amount (g)"
              placeholder="e.g. 150"
              keyboardType="number-pad"
              style={styles.half}
              value={manual.grams}
              onChangeText={(v) => setManual((m) => ({ ...m, grams: v.replace(/[^0-9]/g, '') }))}
            />
            <TextField
              testID="manual-calories"
              label="Calories"
              keyboardType="numeric"
              style={styles.half}
              value={manual.calories}
              onChangeText={(v) => setManual((m) => ({ ...m, calories: v }))}
            />
          </View>
          {/* Recording the weight is what makes the entry re-portionable later. */}
          <Text style={styles.fieldHint}>Weight is optional, but it lets you re-portion this later.</Text>
          <View style={styles.grid2}>
            <TextField
              label="Protein (g)"
              keyboardType="numeric"
              style={styles.half}
              value={manual.protein}
              onChangeText={(v) => setManual((m) => ({ ...m, protein: v }))}
            />
            <TextField
              label="Carbs (g)"
              keyboardType="numeric"
              style={styles.half}
              value={manual.carbs}
              onChangeText={(v) => setManual((m) => ({ ...m, carbs: v }))}
            />
          </View>
          <TextField
            label="Fat (g)"
            keyboardType="numeric"
            value={manual.fat}
            onChangeText={(v) => setManual((m) => ({ ...m, fat: v }))}
          />
          <View style={styles.row}>
            <Button title="Back" variant="ghost" onPress={() => setManualMode(false)} style={styles.flex1} />
            <Button title="Log it" onPress={submitManual} style={styles.flex2} />
          </View>
        </View>
      ) : (
        <View>
          <TextField
            testID="food-search"
            placeholder="Search your foods…"
            autoCapitalize="none"
            value={query}
            onChangeText={setQuery}
          />
          {listLoading ? (
            <ActivityIndicator color={colors.accent} style={{ marginVertical: 20 }} />
          ) : searching2Plus && list.length === 0 ? (
            <View>
              <Text style={styles.hint}>"{query.trim()}" isn't in your library yet.</Text>
              <Button title={`Add "${query.trim()}"`} onPress={openManual} />
            </View>
          ) : !searching2Plus && list.length === 0 ? (
            <Text style={styles.hint}>Nothing logged for {meal} yet — search above, or add a new food.</Text>
          ) : (
            list.map((food) => (
              <View key={food.id} style={styles.itemRow}>
                <Pressable style={styles.item} onPress={() => onSelect(food)}>
                  <Text style={styles.itemName}>{displayName(food)}</Text>
                  <Text style={styles.itemSub}>
                    {macroLine(food)}
                    {!searching2Plus ? ` · ${food.times_logged}× · ${relativeDay(food.last_logged)}` : ''}
                  </Text>
                </Pressable>
                {/* A separate target, so logging the usual amount stays one tap
                    while changing the portion is still reachable. */}
                <Pressable style={styles.portion} onPress={() => onAdjust(food)}>
                  <Text style={styles.portionQty}>{formatGrams(defaultPortion(food).grams)}</Text>
                  <Text style={styles.portionEdit}>EDIT</Text>
                </Pressable>
              </View>
            ))
          )}

          {!searching2Plus ? (
            <Button title="+ Add a food that isn't listed" variant="ghost" onPress={openManual} style={{ marginTop: 8 }} />
          ) : null}
        </View>
      )}
    </Sheet>
  );
}


const styles = StyleSheet.create({
  hint: { color: colors.textDim, fontSize: 14, textAlign: 'center', paddingVertical: 20 },
  fieldHint: { color: colors.textDim, fontSize: 11.5, marginTop: -6, marginBottom: 12 },
  itemRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  item: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius - 2,
    padding: 12,
  },
  itemName: { color: colors.text, fontSize: 15 },
  portion: {
    minWidth: 66,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    paddingHorizontal: 8,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius - 2,
  },
  portionQty: { color: colors.text, fontSize: 13 },
  portionEdit: { color: colors.textDim, fontSize: 9, letterSpacing: 0.6 },
  itemSub: { color: colors.textDim, fontSize: 12.5, marginTop: 2 },
  grid2: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
  row: { flexDirection: 'row', gap: 10, marginTop: 8 },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
});
