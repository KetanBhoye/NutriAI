import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, AppState, InteractionManager, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import Feather from '@expo/vector-icons/Feather';
import { entriesApi, goalsApi } from '@/api';
import {
  enqueueCreate,
  enqueueDelete,
  enqueueUpdate,
  flush as flushQueue,
  isPendingId,
  newPendingId,
  refreshPendingCount,
  subscribePending,
  subscribeRejections,
} from '@/api/queue';
import type { EntriesResponse } from '@/api/entries';
import { cached, readCache } from '@/cache';
import { subscribeGoalsChanged } from '@/goalsBus';
import { addDays, parseISODate, todayISO } from '@/dates';
import { capitalize } from '@/format';
import { FALLBACK_GOALS as FALLBACK } from '@/nutrition';
import { MEALS, currentMeal, groupByMeal, remainingCalories, sumTotals } from '@/meals';
import { defaultPortion, formatGrams, toGrams, type Portion } from '@/portion';
import { colors, fonts, radius } from '@/theme';
import { Button, EmptyState, FadeIn, Loading, Screen, StaleNotice } from '@/components/ui';
import { FoodEntry, Goals, MealType, Suggestion, Totals } from '@/types';
import { MacroBar } from '@/features/today/MacroBar';
import { AddFoodModal } from '@/features/today/AddFoodModal';
import { EntryDetailModal } from '@/features/today/EntryDetailModal';
import { SuggestMealModal } from '@/features/today/SuggestMealModal';
import { PhotoMealModal } from '@/features/today/PhotoMealModal';
import { PortionSheet } from '@/features/today/PortionSheet';
import { BarcodeModal } from '@/features/today/BarcodeModal';
import { ShareStoryModal } from '@/features/today/ShareStoryModal';
import { UpdateBanner } from '@/features/updates/UpdateBanner';

/** Shared with Trends via `src/nutrition.ts`, so the two can't disagree. */
const FALLBACK_GOALS = {
  daily_calorie_goal: FALLBACK.calories,
  daily_protein_goal_g: FALLBACK.protein_g,
  daily_carbs_goal_g: FALLBACK.carbs_g,
  daily_fat_goal_g: FALLBACK.fat_g,
};

function ActionTile({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [tileStyles.tile, pressed && tileStyles.pressed]}
    >
      <Feather name={icon} size={18} color={colors.accent} />
      <Text style={tileStyles.label}>{label}</Text>
    </Pressable>
  );
}

const tileStyles = StyleSheet.create({
  tile: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: radius,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: { opacity: 0.75, borderColor: colors.accentDim },
  label: { color: colors.text, fontFamily: fonts.medium, fontSize: 12.5 },
});

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
  const [showBarcode, setShowBarcode] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [pendingWrites, setPendingWrites] = useState(0);
  /** Suggestion whose portion is being adjusted before logging. */
  const [portionFood, setPortionFood] = useState<Suggestion | null>(null);
  const [portionMeal, setPortionMeal] = useState<MealType>('snack');

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
          if (!res.canceled && res.assets[0]) presentSheet(res.assets[0].uri);
        },
      },
      {
        text: 'Choose from library',
        onPress: async () => {
          const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });
          if (!res.canceled && res.assets[0]) presentSheet(res.assets[0].uri);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  /**
   * The picker's promise resolves while iOS is still dismissing its own modal.
   * Presenting ours during that window leaves it invisible but still capturing
   * touches — the screen looks frozen. Wait for the dismissal to finish first.
   */
  const presentSheet = (uri: string) => {
    InteractionManager.runAfterInteractions(() => {
      setTimeout(() => setPhotoUri(uri), 350);
    });
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
    // Only blank the list when we have nothing cached for that day; otherwise
    // `load` paints the cached entries and swaps in fresh data behind them,
    // so stepping through days doesn't flash a skeleton each time.
    readCache<EntriesResponse>(`entries.${viewDate}`).then((seed) => {
      if (!seed) setLoading(true);
    });
    load(viewDate);
  }, [viewDate, load]);

  const loadGoals = useCallback(async () => {
    try {
      const { data: g } = await cached('goals', () => goalsApi.getGoals());
      if (g.macros.calories) {
        setGoals({
          daily_calorie_goal: g.macros.calories,
          daily_protein_goal_g: g.macros.protein_g,
          daily_carbs_goal_g: g.macros.carbs_g,
          daily_fat_goal_g: g.macros.fat_g,
        });
      }
    } catch {
      // Keep whatever targets are already on screen.
    }
  }, []);

  // This tab stays mounted while you edit the plan on another one, so re-read
  // the targets when they change rather than holding the ones from launch.
  useEffect(() => {
    void loadGoals();
    return subscribeGoalsChanged(() => void loadGoals());
  }, [loadGoals]);

  /**
   * Drains the queue and, if anything actually synced, re-reads the day so the
   * optimistic rows are replaced by the server's canonical ones (real ids,
   * server-resolved food links).
   */
  const reconcile = useCallback(async () => {
    const synced = await flushQueue();
    if (synced > 0) await load(viewDate);
  }, [viewDate, load]);

  // Track how many writes are still waiting, so the UI can say so. Seed from
  // storage too — the queue may hold writes from a previous session.
  useEffect(() => {
    const unsub = subscribePending(setPendingWrites);
    void refreshPendingCount().then(() => reconcile());
    return unsub;
  }, []);

  // A write the server refused is dropped from the queue, so the optimistic row
  // is about to be replaced by the server's version. Say so and re-read, rather
  // than leaving the edit on screen until it quietly reverts on the next load.
  useEffect(
    () =>
      subscribeRejections(['create', 'update', 'delete'], (kind, message) => {
        console.warn(`Rejected ${kind}:`, message);
        Alert.alert(
          "That didn't save",
          kind === 'delete'
            ? "The server wouldn't delete that entry."
            : "The server wouldn't accept that change, so it's been undone."
        );
        void load(viewDate);
      }),
    [load, viewDate]
  );

  // Retry whenever the app comes back to the foreground — that's the most
  // likely moment for connectivity to have returned.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void reconcile();
    });
    return () => sub.remove();
  }, [reconcile]);

  const onRefresh = async () => {
    setRefreshing(true);
    await reconcile();
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

  // The day's arithmetic lives in src/meals.ts, where it's under test.
  const totals = useMemo(() => sumTotals(entries), [entries]);
  const byMeal = useMemo(() => groupByMeal(entries), [entries]);
  const remaining = remainingCalories(
    goals.daily_calorie_goal ?? FALLBACK_GOALS.daily_calorie_goal,
    totals.calories
  );

  const logSuggestion = (suggestion: Suggestion, meal: MealType, portion?: Portion) => {
    // Every entry records a gram weight, so it can be re-portioned later even
    // when the library quotes the food in bowls or pieces.
    const chosen = portion ?? defaultPortion(suggestion);
    const optimistic: FoodEntry = {
      id: newPendingId(),
      user_id: '',
      food_name: suggestion.canonical_name,
      calories: chosen.calories,
      protein_g: chosen.protein_g,
      carbs_g: chosen.carbs_g,
      fat_g: chosen.fat_g,
      meal_type: meal,
      entry_date: viewDate,
      food_id: suggestion.id,
      quantity: chosen.grams,
      unit: 'g',
      created_at: '',
      updated_at: '',
    };
    setEntries((prev) => [optimistic, ...prev]);
    setActiveMeal(null);
    // The row appears instantly, so a tap confirms it landed rather than
    // leaving the user unsure whether the press registered.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void enqueueCreate(optimistic.id, {
      food_name: optimistic.food_name,
      calories: optimistic.calories,
      protein_g: optimistic.protein_g ?? undefined,
      carbs_g: optimistic.carbs_g ?? undefined,
      fat_g: optimistic.fat_g ?? undefined,
      meal_type: meal,
      entry_date: viewDate,
      food_id: suggestion.id,
      quantity: chosen.grams,
      unit: 'g',
    }).then(() => reconcile());
  };

  const logManual = (
    meal: MealType,
    input: { food_name: string; calories: number; protein_g?: number; carbs_g?: number; fat_g?: number; grams?: number }
  ) => {
    const { grams, ...macros } = input;
    const optimistic: FoodEntry = {
      id: newPendingId(),
      user_id: '',
      food_name: macros.food_name,
      calories: macros.calories,
      protein_g: macros.protein_g ?? null,
      carbs_g: macros.carbs_g ?? null,
      fat_g: macros.fat_g ?? null,
      meal_type: meal,
      entry_date: viewDate,
      food_id: null,
      quantity: grams ?? null,
      unit: grams ? 'g' : null,
      created_at: '',
      updated_at: '',
    };
    setEntries((prev) => [optimistic, ...prev]);
    setActiveMeal(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void enqueueCreate(optimistic.id, {
      ...macros,
      meal_type: meal,
      entry_date: viewDate,
      ...(grams ? { quantity: grams, unit: 'g' } : {}),
    }).then(() => reconcile());
  };

  const removeEntry = (entry: FoodEntry) => {
    setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    setViewingEntry(null);
    void enqueueDelete(entry.id).then(() => reconcile());
  };

  const saveEntry = (entry: FoodEntry, changes: Partial<FoodEntry>) => {
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, ...changes } : e)));
    setViewingEntry(null);
    void enqueueUpdate(entry.id, changes).then(() => reconcile());
  };

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <View style={styles.header}>
        <View style={styles.dateNav}>
          <Pressable testID="day-back" onPress={() => shiftDate(-1)} hitSlop={10} style={styles.navBtn}>
            <Text style={styles.navBtnText}>‹</Text>
          </Pressable>
          <View>
            <Text style={styles.dateLabel}>{dateLabel}</Text>
            <Text style={styles.dateSub}>{viewDate}</Text>
          </View>
          <Pressable testID="day-forward" onPress={() => shiftDate(1)} hitSlop={10} disabled={isToday} style={styles.navBtn}>
            <Text style={[styles.navBtnText, isToday && styles.navBtnDisabled]}>›</Text>
          </Pressable>
        </View>
        <View style={styles.headRightRow}>
          <Pressable onPress={() => setShowShare(true)} hitSlop={10} style={styles.shareBtn}>
            <Feather name="share" size={17} color={colors.accent} />
          </Pressable>
          <View style={styles.headRight}>
            <Text style={styles.bigNumber}>{Math.round(totals.calories)}</Text>
            <Text style={styles.remaining}>{Math.round(remaining)} left</Text>
          </View>
        </View>
      </View>

      {!isToday ? (
        <Button title="Jump to today" variant="ghost" onPress={() => setViewDate(today)} style={styles.jumpToday} />
      ) : null}

      {pendingWrites > 0 ? (
        <StaleNotice
          label={`${pendingWrites} change${pendingWrites === 1 ? '' : 's'} waiting to sync — they're saved on this device.`}
        />
      ) : null}

      {/* Below the sync notice on purpose: an unsynced change is about the
          user's own data and outranks news about the app. */}
      <UpdateBanner />

      {/* Three secondary ways in, as compact tiles — stacking them as
          full-width buttons pushed the day's actual food below the fold. */}
      <View style={styles.actionRow}>
        <ActionTile icon="camera" label="Snap" onPress={pickPhoto} />
        <ActionTile icon="maximize" label="Scan" onPress={() => setShowBarcode(true)} />
        <ActionTile icon="coffee" label="Ideas" onPress={() => setShowSuggest(true)} />
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

          {loading ? <Loading /> : MEALS.map((meal, mealIndex) => (
            <View key={meal} style={styles.mealSection}>
              <Text style={styles.mealTitle}>{meal}</Text>
              {byMeal[meal].map((entry, entryIndex) => (
                // Staggered by position down the whole day, not within the
                // meal, so the log assembles top-down rather than four
                // sections animating in parallel.
                <FadeIn key={entry.id} index={mealIndex * 2 + entryIndex} style={styles.entry}>
                  <View style={styles.entryRow}>
                  <Pressable style={styles.entryMain} onPress={() => setViewingEntry(entry)}>
                    <Text style={styles.entryName} numberOfLines={1}>
                      {entry.food_name}
                    </Text>
                    <Text style={styles.entrySub}>
                      {(() => {
                        const g = toGrams(entry.quantity, entry.unit);
                        return g != null ? `${formatGrams(g)} · ` : '';
                      })()}
                      {entry.calories} kcal{entry.protein_g ? ` · ${entry.protein_g}g protein` : ''}
                      {isPendingId(entry.id) ? '  queued' : ''}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => removeEntry(entry)} hitSlop={10} style={styles.removeBtn}>
                    <Text style={styles.removeText}>×</Text>
                  </Pressable>
                  </View>
                </FadeIn>
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
        onAdjust={(s) => {
          setPortionMeal(activeMeal ?? 'snack');
          setPortionFood(s);
          setActiveMeal(null);
        }}
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

      <PortionSheet
        food={portionFood}
        onCancel={() => setPortionFood(null)}
        onConfirm={(portion) => {
          const food = portionFood;
          setPortionFood(null);
          if (food) logSuggestion(food, portionMeal, portion);
        }}
      />

      <ShareStoryModal visible={showShare} date={viewDate} onClose={() => setShowShare(false)} />

      <BarcodeModal
        visible={showBarcode}
        date={viewDate}
        defaultMeal={currentMeal()}
        onClose={() => setShowBarcode(false)}
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
  headRightRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headRight: { alignItems: 'flex-end' },
  shareBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bigNumber: { color: colors.text, fontSize: 26, fontFamily: fonts.bold },
  remaining: { color: colors.textDim, fontSize: 13 },
  jumpToday: { marginTop: 12, paddingVertical: 8 },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  quickBtn: { marginTop: 10 },
  mealSection: { marginTop: 22 },
  mealTitle: { color: colors.text, fontSize: 16, fontFamily: fonts.bold, marginBottom: 10, textTransform: 'capitalize' },
  // Split in two: the card chrome sits on the animated wrapper, the row
  // layout on the view inside it. Leaving `flexDirection: row` on the wrapper
  // would lay the animated container out as a row and collapse the card.
  entry: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius - 2,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  entryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
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
