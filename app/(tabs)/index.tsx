import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { entriesApi, goalsApi } from '@/api';
import type { EntriesResponse } from '@/api/entries';
import { cached, readCache } from '@/cache';
import { addDays, parseISODate, todayISO } from '@/dates';
import { capitalize } from '@/format';
import { colors, fonts, radius } from '@/theme';
import { Button, EmptyState, Loading, Screen } from '@/components/ui';
import { FoodEntry, Goals, MealType, Suggestion, Totals } from '@/types';
import { MacroBar } from '@/features/today/MacroBar';
import { AddFoodModal } from '@/features/today/AddFoodModal';
import { EntryDetailModal } from '@/features/today/EntryDetailModal';
import { SuggestMealModal } from '@/features/today/SuggestMealModal';
import { PhotoMealModal } from '@/features/today/PhotoMealModal';

const MEALS: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const FALLBACK_GOALS = { daily_calorie_goal: 2000, daily_protein_goal_g: 150, daily_carbs_goal_g: 200, daily_fat_goal_g: 65 };

function currentMeal(): MealType {
  const hour = new Date().getHours();
  if (hour < 11) return 'breakfast';
  if (hour < 16) return 'lunch';
  if (hour < 21) return 'dinner';
  return 'snack';
}

function emptyTotals(): Totals {
  return { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
}

export default function Today() {
  const { date: dateParam } = useLocalSearchParams<{ date?: string }>();
  const today = todayISO();

  // Deep-linked from Coach's "✓ updated your log" — jump straight to that day.
  const [viewDate, setViewDate] = useState(
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) && dateParam <= today ? dateParam : today
  );
  const [entries, setEntries] = useState<FoodEntry[]>([]);
  const [goals, setGoals] = useState<Goals>(FALLBACK_GOALS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [activeMeal, setActiveMeal] = useState<MealType | null>(null);
  const [viewingEntry, setViewingEntry] = useState<FoodEntry | null>(null);
  const [showSuggest, setShowSuggest] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  /** Offers camera or library, then hands the local URI to PhotoMealModal. */
  const pickPhoto = () => {
    Alert.alert('Snap a meal', 'Let the AI coach read your plate and log it.', [
      {
        text: 'Take photo',
        onPress: async () => {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) {
            Alert.alert('Camera access needed', 'Enable camera access for NutriAI in Settings.');
            return;
          }
          const res = await ImagePicker.launchCameraAsync({ quality: 0.8 });
          if (!res.canceled && res.assets[0]) setPhotoUri(res.assets[0].uri);
        },
      },
      {
        text: 'Choose from library',
        onPress: async () => {
          const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });
          if (!res.canceled && res.assets[0]) setPhotoUri(res.assets[0].uri);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const load = useCallback(async (date: string) => {
    setError(null);
    try {
      // Paint from cache first so switching days (or a cold start) shows real
      // data immediately rather than an empty list while the request runs.
      const seed = await readCache<EntriesResponse>(`entries.${date}`);
      if (seed) {
        setEntries(seed.entries);
        setLoading(false);
      }
      const { data } = await cached(`entries.${date}`, () => entriesApi.getEntries(date));
      setEntries(data.entries);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) && dateParam <= today && dateParam !== viewDate) {
      setViewDate(dateParam);
    }
  }, [dateParam]);

  useEffect(() => {
    setLoading(true);
    load(viewDate);
  }, [viewDate, load]);

  useEffect(() => {
    cached('goals', () => goalsApi.getGoals())
      .then(({ data: g }) => {
        if (g.macros.calories) {
          setGoals({
            daily_calorie_goal: g.macros.calories,
            daily_protein_goal_g: g.macros.protein_g,
            daily_carbs_goal_g: g.macros.carbs_g,
            daily_fat_goal_g: g.macros.fat_g,
          });
        }
      })
      .catch(() => {});
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await load(viewDate);
    setRefreshing(false);
  };

  const isToday = viewDate === today;
  const dateLabel = isToday
    ? 'Today'
    : viewDate === addDays(today, -1)
      ? 'Yesterday'
      : parseISODate(viewDate).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });

  const shiftDate = (days: number) => {
    const next = addDays(viewDate, days);
    if (next > today) return;
    setViewDate(next);
  };

  const totals = useMemo(
    () =>
      entries.reduce<Totals>(
        (acc, e) => ({
          calories: acc.calories + e.calories,
          protein_g: acc.protein_g + (e.protein_g ?? 0),
          carbs_g: acc.carbs_g + (e.carbs_g ?? 0),
          fat_g: acc.fat_g + (e.fat_g ?? 0),
        }),
        emptyTotals()
      ),
    [entries]
  );

  const byMeal = useMemo(() => {
    const grouped: Record<MealType, FoodEntry[]> = { breakfast: [], lunch: [], dinner: [], snack: [] };
    for (const e of entries) if (e.meal_type) grouped[e.meal_type].push(e);
    return grouped;
  }, [entries]);

  const remaining = Math.max(0, (goals.daily_calorie_goal ?? FALLBACK_GOALS.daily_calorie_goal) - totals.calories);

  const logSuggestion = (suggestion: Suggestion, meal: MealType, portion?: number) => {
    const quantity = portion ?? suggestion.default_quantity;
    const scale = (v: number | null) => (v === null ? null : Math.round(v * quantity * 10) / 10);
    const optimistic: FoodEntry = {
      id: `tmp-${Date.now()}`,
      user_id: '',
      food_name: suggestion.canonical_name,
      calories: Math.round(suggestion.calories_per_unit * quantity),
      protein_g: scale(suggestion.protein_g_per_unit),
      carbs_g: scale(suggestion.carbs_g_per_unit),
      fat_g: scale(suggestion.fat_g_per_unit),
      meal_type: meal,
      entry_date: viewDate,
      food_id: suggestion.id,
      quantity,
      unit: suggestion.reference_unit,
      created_at: '',
      updated_at: '',
    };
    setEntries((prev) => [optimistic, ...prev]);
    setActiveMeal(null);
    entriesApi
      .createEntry({
        food_name: optimistic.food_name,
        calories: optimistic.calories,
        protein_g: optimistic.protein_g ?? undefined,
        carbs_g: optimistic.carbs_g ?? undefined,
        fat_g: optimistic.fat_g ?? undefined,
        meal_type: meal,
        entry_date: viewDate,
        food_id: suggestion.id,
        quantity,
        unit: suggestion.reference_unit,
      })
      .then((res) => {
        setEntries((prev) => prev.map((e) => (e.id === optimistic.id ? { ...e, id: res.entry_id } : e)));
      })
      .catch(() => {
        setEntries((prev) => prev.filter((e) => e.id !== optimistic.id));
        Alert.alert("Couldn't log", 'Check your connection and try again.');
      });
  };

  const logManual = (meal: MealType, input: { food_name: string; calories: number; protein_g?: number; carbs_g?: number; fat_g?: number }) => {
    const optimistic: FoodEntry = {
      id: `tmp-${Date.now()}`,
      user_id: '',
      food_name: input.food_name,
      calories: input.calories,
      protein_g: input.protein_g ?? null,
      carbs_g: input.carbs_g ?? null,
      fat_g: input.fat_g ?? null,
      meal_type: meal,
      entry_date: viewDate,
      food_id: null,
      quantity: null,
      unit: null,
      created_at: '',
      updated_at: '',
    };
    setEntries((prev) => [optimistic, ...prev]);
    setActiveMeal(null);
    entriesApi
      .createEntry({ ...input, meal_type: meal, entry_date: viewDate })
      .then((res) => {
        setEntries((prev) => prev.map((e) => (e.id === optimistic.id ? { ...e, id: res.entry_id } : e)));
      })
      .catch(() => {
        setEntries((prev) => prev.filter((e) => e.id !== optimistic.id));
        Alert.alert("Couldn't log", 'Check your connection and try again.');
      });
  };

  const removeEntry = (entry: FoodEntry) => {
    setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    setViewingEntry(null);
    if (!entry.id.startsWith('tmp-')) {
      entriesApi.deleteEntry(entry.id).catch(() => Alert.alert("Couldn't delete", 'Check your connection.'));
    }
  };

  const saveEntry = (entry: FoodEntry, changes: Partial<FoodEntry>) => {
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, ...changes } : e)));
    setViewingEntry(null);
    if (!entry.id.startsWith('tmp-')) {
      entriesApi.updateEntry(entry.id, changes).catch(() => Alert.alert("Couldn't save", 'Check your connection.'));
    }
  };

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <View style={styles.header}>
        <View style={styles.dateNav}>
          <Pressable onPress={() => shiftDate(-1)} hitSlop={10} style={styles.navBtn}>
            <Text style={styles.navBtnText}>‹</Text>
          </Pressable>
          <View>
            <Text style={styles.dateLabel}>{dateLabel}</Text>
            <Text style={styles.dateSub}>{viewDate}</Text>
          </View>
          <Pressable onPress={() => shiftDate(1)} hitSlop={10} disabled={isToday} style={styles.navBtn}>
            <Text style={[styles.navBtnText, isToday && styles.navBtnDisabled]}>›</Text>
          </Pressable>
        </View>
        <View style={styles.headRight}>
          <Text style={styles.bigNumber}>{Math.round(totals.calories)}</Text>
          <Text style={styles.remaining}>{Math.round(remaining)} left</Text>
        </View>
      </View>

      {!isToday ? (
        <Button title="Jump to today" variant="ghost" onPress={() => setViewDate(today)} style={styles.jumpToday} />
      ) : null}

      <Pressable style={styles.snapCta} onPress={pickPhoto}>
        <Text style={styles.snapText}>
          📷 Snap a meal <Text style={styles.snapHint}>— AI logs it</Text>
        </Text>
      </Pressable>

      <View style={styles.actionRow}>
        <Button title="🍽️ What to eat?" variant="ghost" onPress={() => setShowSuggest(true)} style={styles.actionBtn} />
      </View>

      <Button
        title={`Quick log ${capitalize(currentMeal())}`}
        onPress={() => setActiveMeal(currentMeal())}
        style={styles.quickBtn}
      />

      {error ? (
        <EmptyState message={error} />
      ) : (
        <>
          <MacroBar
            totals={totals}
            goals={{
              daily_calorie_goal: goals.daily_calorie_goal ?? FALLBACK_GOALS.daily_calorie_goal,
              daily_protein_goal_g: goals.daily_protein_goal_g ?? FALLBACK_GOALS.daily_protein_goal_g,
              daily_carbs_goal_g: goals.daily_carbs_goal_g ?? FALLBACK_GOALS.daily_carbs_goal_g,
              daily_fat_goal_g: goals.daily_fat_goal_g ?? FALLBACK_GOALS.daily_fat_goal_g,
            }}
          />

          {loading ? <Loading /> : MEALS.map((meal) => (
            <View key={meal} style={styles.mealSection}>
              <Text style={styles.mealTitle}>{meal}</Text>
              {byMeal[meal].map((entry) => (
                <View key={entry.id} style={styles.entry}>
                  <Pressable style={styles.entryMain} onPress={() => setViewingEntry(entry)}>
                    <Text style={styles.entryName} numberOfLines={1}>
                      {entry.food_name}
                    </Text>
                    <Text style={styles.entrySub}>
                      {entry.calories} kcal{entry.protein_g ? ` · ${entry.protein_g}g protein` : ''}
                      {entry.id.startsWith('tmp-') ? '  queued' : ''}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => removeEntry(entry)} hitSlop={10} style={styles.removeBtn}>
                    <Text style={styles.removeText}>×</Text>
                  </Pressable>
                </View>
              ))}
              <Pressable style={styles.addBtn} onPress={() => setActiveMeal(meal)}>
                <Text style={styles.addBtnText}>+ Add {meal}</Text>
              </Pressable>
            </View>
          ))}
        </>
      )}

      <AddFoodModal
        visible={!!activeMeal}
        meal={activeMeal ?? 'snack'}
        onClose={() => setActiveMeal(null)}
        onSelect={(s) => logSuggestion(s, activeMeal ?? 'snack')}
        onManual={(input) => logManual(activeMeal ?? 'snack', input)}
      />

      <EntryDetailModal
        entry={viewingEntry}
        onClose={() => setViewingEntry(null)}
        onSave={(changes) => viewingEntry && saveEntry(viewingEntry, changes)}
        onDelete={() => viewingEntry && removeEntry(viewingEntry)}
      />

      <SuggestMealModal
        visible={showSuggest}
        meal={currentMeal()}
        date={viewDate}
        onClose={() => setShowSuggest(false)}
        onLogged={() => load(viewDate)}
      />

      <PhotoMealModal
        uri={photoUri}
        date={viewDate}
        defaultMeal={currentMeal()}
        onClose={() => setPhotoUri(null)}
        onLogged={() => load(viewDate)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dateNav: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  navBtn: { width: 32, alignItems: 'center', justifyContent: 'center' },
  navBtnText: { color: colors.textDim, fontSize: 24 },
  navBtnDisabled: { opacity: 0.25 },
  dateLabel: { color: colors.text, fontSize: 22, fontFamily: fonts.extrabold },
  dateSub: { color: colors.textDim, fontSize: 12, marginTop: 1 },
  headRight: { alignItems: 'flex-end' },
  bigNumber: { color: colors.text, fontSize: 26, fontFamily: fonts.bold },
  remaining: { color: colors.textDim, fontSize: 13 },
  jumpToday: { marginTop: 12, paddingVertical: 8 },
  snapCta: {
    marginTop: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: radius,
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.4)',
    backgroundColor: 'rgba(74,222,128,0.10)',
  },
  snapText: { color: colors.accent, fontFamily: fonts.semibold, fontSize: 15 },
  snapHint: { color: colors.textDim, fontFamily: fonts.regular },
  actionRow: { marginTop: 10 },
  actionBtn: {},
  quickBtn: { marginTop: 10 },
  mealSection: { marginTop: 22 },
  mealTitle: { color: colors.text, fontSize: 16, fontFamily: fonts.bold, marginBottom: 10, textTransform: 'capitalize' },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius - 2,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  entryMain: { flex: 1, marginRight: 8 },
  entryName: { color: colors.text, fontSize: 15 },
  entrySub: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  removeBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  removeText: { color: colors.textDim, fontSize: 22 },
  addBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: radius - 2,
    paddingVertical: 12,
    alignItems: 'center',
  },
  addBtnText: { color: colors.textDim, fontSize: 15, textTransform: 'capitalize' },
});
