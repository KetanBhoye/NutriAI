import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { entriesApi } from '@/api';
import type { FoodLookupResult } from '@/api/entries';
import { Button, NutriLoader, Sheet, TextField } from '@/components/ui';
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
  /**
   * Matches from the public food databases, fetched only when the user's own
   * library has nothing for the query.
   *
   * Without this the sheet is a dead end on day one: suggestions come from
   * what you have already logged, and the search box searched the same empty
   * library, so a new user could only log food by typing its calories from
   * memory.
   */
  const [external, setExternal] = useState<FoodLookupResult[]>([]);
  const [externalLoading, setExternalLoading] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manual, setManual] = useState({ name: '', calories: '', protein: '', carbs: '', fat: '', grams: '' });
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  /** Guards against a slow response for an older query landing last. */
  const latestQuery = useRef('');

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
    const term = query.trim();
    latestQuery.current = term;
    if (term.length < 2) {
      setResults([]);
      setExternal([]);
      setSearching(false);
      setExternalLoading(false);
      return;
    }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      let library: Suggestion[] = [];
      try {
        library = (await entriesApi.searchFoods(term)).foods;
      } catch {
        library = [];
      }
      if (latestQuery.current !== term) return;
      setResults(library);
      setSearching(false);

      // Only when the library came up empty. An established user typing a food
      // they log every week should not wait on a network call to a food
      // database to be told what they already have.
      if (library.length > 0) {
        setExternal([]);
        return;
      }
      setExternalLoading(true);
      try {
        const found = await entriesApi.lookupFoods(term);
        if (latestQuery.current === term) setExternal(found.results);
      } catch {
        if (latestQuery.current === term) setExternal([]);
      } finally {
        if (latestQuery.current === term) setExternalLoading(false);
      }
    }, 250);
    return () => clearTimeout(searchTimer.current);
  }, [query]);

  const openManual = () => {
    setManual((m) => ({ ...m, name: query.trim() }));
    setManualMode(true);
  };

  /**
   * A database match opens the manual form rather than logging straight away.
   *
   * Two reasons: these numbers are per 100 g of a product the user may be
   * eating a different amount of, and Open Food Facts is crowd-sourced, so the
   * values deserve a look before they become a diary entry. Everything is
   * filled in, so confirming is one tap.
   */
  const prefillFrom = (food: FoodLookupResult) => {
    const portion = defaultPortion(food);
    setManual({
      name: food.brand ? `${food.name} (${food.brand})` : food.name,
      calories: String(portion.calories),
      protein: portion.protein_g != null ? String(portion.protein_g) : '',
      carbs: portion.carbs_g != null ? String(portion.carbs_g) : '',
      fat: portion.fat_g != null ? String(portion.fat_g) : '',
      grams: String(Math.round(portion.grams)),
    });
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
            placeholder="Search foods…"
            autoCapitalize="none"
            value={query}
            onChangeText={setQuery}
          />
          {listLoading ? (
            <NutriLoader size={40} />
          ) : searching2Plus && list.length === 0 ? (
            <View>
              {externalLoading ? (
                <NutriLoader size={40} />
              ) : external.length > 0 ? (
                <View>
                  <Text style={styles.sectionLabel}>From the food database</Text>
                  {external.map((food, i) => {
                    const portion = defaultPortion(food);
                    return (
                      <Pressable
                        key={`${food.source}-${food.source_ref ?? i}`}
                        style={styles.item}
                        onPress={() => prefillFrom(food)}
                      >
                        <Text style={styles.itemName}>{food.name}</Text>
                        <Text style={styles.itemSub}>
                          {[food.brand, `${formatGrams(portion.grams)} · ${portion.calories} kcal`]
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                        {/* Shown, not hidden: the alternative is letting a
                            physically impossible figure into the diary. */}
                        {food.suspect ? (
                          <Text style={styles.suspect}>⚠ These numbers look off — check before logging.</Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
                  <Text style={styles.hint}>Not it? Add it yourself:</Text>
                </View>
              ) : (
                <Text style={styles.hint}>"{query.trim()}" isn't in your library or the food database.</Text>
              )}
              <Button title={`Add "${query.trim()}"`} onPress={openManual} />
            </View>
          ) : !searching2Plus && list.length === 0 ? (
            <Text style={styles.hint}>
              Nothing logged for {meal} yet — search above for any food, or add your own.
            </Text>
          ) : (
            list.map((food) => (
              <View key={food.id} style={styles.itemRow}>
                <Pressable style={styles.item} onPress={() => onSelect(food)}>
                  <Text style={styles.itemName}>{displayName(food)}</Text>
                  <Text style={styles.itemSub}>
                    {macroLine(food)}
                    {/* Your own foods carry your history; a shared row says so
                        instead, rather than showing "0× · " and looking broken. */}
                    {food.origin === 'shared'
                      ? ' · food library'
                      : !searching2Plus
                        ? ` · ${food.times_logged}× · ${relativeDay(food.last_logged)}`
                        : ''}
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
  sectionLabel: {
    color: colors.textDim,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 6,
    marginBottom: 4,
  },
  suspect: { color: colors.warn, fontSize: 11.5, marginTop: 3 },
  grid2: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
  row: { flexDirection: 'row', gap: 10, marginTop: 8 },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
});
