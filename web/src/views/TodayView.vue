<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  api,
  FALLBACK_GOALS,
  pendingCount,
  type Goals,
  type FoodEntry,
  type MealType,
  type Suggestion,
  type Totals,
} from '../api';
import EntryDetailSheet from '../components/EntryDetailSheet.vue';
import { addDays, parseISODate, todayISO } from '../dates';
import MacroBar from '../components/MacroBar.vue';
import NewFoodSheet from '../components/NewFoodSheet.vue';
import PortionSheet from '../components/PortionSheet.vue';
import QuickLogSheet from '../components/QuickLogSheet.vue';
import ShareStory from '../components/ShareStory.vue';
import PhotoMealSheet from '../components/PhotoMealSheet.vue';
import SuggestMealSheet from '../components/SuggestMealSheet.vue';
import BarcodeScanner from '../components/BarcodeScanner.vue';

const MEALS: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/**
 * Goals come from tracking preferences, which are editable through the MCP
 * connector. The fallback only covers the first paint and a missing record.
 */
const goals = ref<Goals>({ ...FALLBACK_GOALS });

const today = todayISO();
/**
 * The day being viewed. Defaults to today; the header arrows move it. A
 * `?date=YYYY-MM-DD` query (e.g. from the Coach's "updated your log" link)
 * opens straight to that day.
 */
const route = useRoute();
const queryDate = typeof route.query.date === 'string' ? route.query.date : '';
const viewDate = ref(/^\d{4}-\d{2}-\d{2}$/.test(queryDate) && queryDate <= today ? queryDate : today);
const entries = ref<FoodEntry[]>([]);
const totals = ref<Totals>({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
const loading = ref(true);
const loadError = ref<string | null>(null);

const activeMeal = ref<MealType | null>(null);
const suggestions = ref<Suggestion[]>([]);
const suggestionsLoading = ref(false);
const showShare = ref(false);
const showSuggest = ref(false);
const showBarcode = ref(false);

// ── Photo meal logging ────────────────────────────────────
const photoInput = ref<HTMLInputElement | null>(null);
const photoFile = ref<File | null>(null);

function openPhoto(): void {
  photoInput.value?.click();
}

function onPhotoPicked(e: Event): void {
  const file = (e.target as HTMLInputElement).files?.[0] ?? null;
  if (file) photoFile.value = file;
  // reset so picking the same file again re-fires change
  (e.target as HTMLInputElement).value = '';
}

async function onPhotoLogged(): Promise<void> {
  photoFile.value = null;
  await load();
}

/** Set while adjusting a portion; null when the quick list is showing. */
const adjusting = ref<Suggestion | null>(null);
/** Set while adding a food that isn't in the library. */
const addingNew = ref<string | null>(null);
/** The entry whose details are open. */
const viewingEntry = ref<FoodEntry | null>(null);

function shiftDate(days: number): void {
  const next = addDays(viewDate.value, days);
  // Logging ahead of time isn't meaningful, so don't allow future days.
  if (next > today) return;
  viewDate.value = next;
}

const isToday = computed(() => viewDate.value === today);

const dateLabel = computed(() => {
  if (isToday.value) return 'Today';
  if (viewDate.value === addDays(today, -1)) return 'Yesterday';
  return parseISODate(viewDate.value).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });
});

/** Meal slot guessed from the clock, so the sheet opens on the likely one. */
function currentMeal(): MealType {
  const hour = new Date().getHours();
  if (hour < 11) return 'breakfast';
  if (hour < 16) return 'lunch';
  if (hour < 21) return 'dinner';
  return 'snack';
}

function recomputeTotals(): void {
  totals.value = entries.value.reduce(
    (acc, entry) => ({
      calories: acc.calories + entry.calories,
      protein_g: acc.protein_g + (entry.protein_g ?? 0),
      carbs_g: acc.carbs_g + (entry.carbs_g ?? 0),
      fat_g: acc.fat_g + (entry.fat_g ?? 0),
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  );
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    const data = await api.getEntries(viewDate.value);
    entries.value = data.entries;
    recomputeTotals();
  } catch {
    // The service worker serves the last cached day when offline; a hard
    // failure here means there is nothing cached either.
    loadError.value = "Couldn't load entries for this day.";
  } finally {
    loading.value = false;
  }
}

async function openMeal(meal: MealType): Promise<void> {
  activeMeal.value = meal;
  suggestions.value = [];
  suggestionsLoading.value = true;
  try {
    const data = await api.getSuggestions(meal);
    suggestions.value = data.suggestions;
  } catch {
    suggestions.value = [];
  } finally {
    suggestionsLoading.value = false;
  }
}

/**
 * Logs a food at a given portion, defaulting to the usual amount. Writes
 * optimistically; the queue guarantees delivery.
 */
function logSuggestion(
  suggestion: Suggestion,
  meal: MealType,
  portion?: number
): void {
  const quantity = portion ?? suggestion.default_quantity;
  const scale = (value: number | null) =>
    value === null ? null : Math.round(value * quantity * 10) / 10;

  const entry: FoodEntry = {
    id: crypto.randomUUID(),
    food_name: suggestion.canonical_name,
    calories: Math.round(suggestion.calories_per_unit * quantity),
    protein_g: scale(suggestion.protein_g_per_unit),
    carbs_g: scale(suggestion.carbs_g_per_unit),
    fat_g: scale(suggestion.fat_g_per_unit),
    meal_type: meal,
    entry_date: viewDate.value,
    pending: true,
  };

  entries.value = [entry, ...entries.value];
  recomputeTotals();

  api.createEntry({
    food_name: entry.food_name,
    calories: entry.calories,
    protein_g: entry.protein_g ?? undefined,
    carbs_g: entry.carbs_g ?? undefined,
    fat_g: entry.fat_g ?? undefined,
    meal_type: meal,
    entry_date: viewDate.value,
    food_id: suggestion.id,
    quantity,
    unit: suggestion.reference_unit,
  });

  activeMeal.value = null;
  adjusting.value = null;
  addingNew.value = null;
  if (navigator.vibrate) navigator.vibrate(8);
}

/** A newly created food goes straight to the portion step, pre-filled. */
function onFoodCreated(food: Suggestion): void {
  addingNew.value = null;
  adjusting.value = food;
}

function removeEntry(entry: FoodEntry): void {
  entries.value = entries.value.filter((candidate) => candidate.id !== entry.id);
  recomputeTotals();
  viewingEntry.value = null;
  if (!entry.pending) api.deleteEntry(entry.id);
}

function saveEntry(entry: FoodEntry, changes: Partial<FoodEntry>): void {
  entries.value = entries.value.map((candidate) =>
    candidate.id === entry.id ? { ...candidate, ...changes } : candidate
  );
  recomputeTotals();
  viewingEntry.value = null;

  // A still-queued entry has no server-side row to patch yet; the queued
  // create would overwrite the edit, so re-queue rather than PATCH.
  if (entry.pending) return;
  api.updateEntry(entry.id, changes);
}

const byMeal = computed(() => {
  const grouped: Record<MealType, FoodEntry[]> = {
    breakfast: [],
    lunch: [],
    dinner: [],
    snack: [],
  };
  for (const entry of entries.value) {
    if (entry.meal_type) grouped[entry.meal_type].push(entry);
  }
  return grouped;
});

const remaining = computed(() => Math.max(0, goals.value.calories - totals.value.calories));

watch(activeMeal, (meal) => {
  document.body.style.overflow = meal ? 'hidden' : '';
});

// Once the write queue drains, nothing on screen is still pending — clear the
// badges rather than leaving rows labelled "queued" after they've synced.
watch(pendingCount, (count) => {
  if (count === 0) {
    entries.value = entries.value.map((entry) =>
      entry.pending ? { ...entry, pending: false } : entry
    );
  }
});

watch(viewDate, load);

onMounted(async () => {
  await load();
  try {
    goals.value = await api.getGoals();
  } catch {
    // Keep the fallback; goals are display-only and must not block logging.
  }
});
</script>

<template>
  <div class="page">
    <header class="spread">
      <div style="min-width: 0">
        <div class="date-nav">
          <button class="nav-btn" aria-label="Previous day" @click="shiftDate(-1)">‹</button>
          <div class="date-label">
            <h1>{{ dateLabel }}</h1>
            <p class="muted date-sub">{{ viewDate }}</p>
          </div>
          <button
            class="nav-btn"
            aria-label="Next day"
            :disabled="isToday"
            @click="shiftDate(1)"
          >
            ›
          </button>
        </div>
      </div>
      <div class="head-right">
        <button class="share-btn" aria-label="Share my day" @click="showShare = true">
          <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
            <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13"
              fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <div style="text-align: right">
          <div style="font-size: 26px; font-weight: 700">{{ totals.calories }}</div>
          <div class="muted" style="font-size: 13px">{{ remaining }} left</div>
        </div>
      </div>
    </header>

    <button v-if="!isToday" class="jump-today" @click="viewDate = today">
      Jump to today
    </button>

    <!-- Snap a meal: AI reads the photo and logs it. -->
    <button class="snap-cta" @click="openPhoto">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path d="M4 8a2 2 0 0 1 2-2h1.5l1-1.5h5L15.5 6H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
          fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
      </svg>
      <span>Snap a meal <em>— AI logs it</em></span>
    </button>
    <input
      ref="photoInput"
      type="file"
      accept="image/*"
      capture="environment"
      class="hidden-input"
      @change="onPhotoPicked"
    />

    <div class="action-row">
      <button class="mini-cta" @click="showSuggest = true">🍽️ What to eat?</button>
      <button class="mini-cta" @click="showBarcode = true">📷 Scan barcode</button>
    </div>

    <!-- Primary path: opens straight onto the meal slot the clock implies,
         so a repeat log is two taps from launch. -->
    <button class="btn quick" @click="openMeal(currentMeal())">
      Quick log {{ currentMeal() }}
    </button>

    <div v-if="loading" class="card" style="margin-top: 16px">
      <div class="skeleton" style="height: 18px; width: 45%; margin-bottom: 14px"></div>
      <div class="skeleton" style="height: 10px; margin-bottom: 8px"></div>
      <div class="skeleton" style="height: 10px; width: 70%"></div>
    </div>

    <div v-else-if="loadError" class="card" style="margin-top: 16px">
      <p style="margin: 0 0 12px">{{ loadError }}</p>
      <button class="btn btn-ghost" @click="load">Try again</button>
    </div>

    <template v-else>
      <MacroBar :totals="totals" :goals="goals" />

      <section v-for="meal in MEALS" :key="meal">
        <h2>{{ meal }}</h2>

        <TransitionGroup name="fade" tag="div">
          <div v-for="entry in byMeal[meal]" :key="entry.id" class="entry">
            <button class="entry-main" @click="viewingEntry = entry">
              <span class="entry-name">{{ entry.food_name }}</span>
              <span class="muted entry-sub">
                {{ entry.calories }} kcal
                <template v-if="entry.protein_g"> · {{ entry.protein_g }}g protein</template>
                <span v-if="entry.pending" class="pending">queued</span>
              </span>
            </button>
            <button
              class="remove"
              :aria-label="`Remove ${entry.food_name}`"
              @click="removeEntry(entry)"
            >
              ×
            </button>
          </div>
        </TransitionGroup>

        <button class="add" @click="openMeal(meal)">
          + Add {{ meal }}
        </button>
      </section>
    </template>

    <QuickLogSheet
      v-if="activeMeal && !adjusting && addingNew === null"
      :meal="activeMeal"
      :suggestions="suggestions"
      :loading="suggestionsLoading"
      @select="logSuggestion($event, activeMeal!)"
      @adjust="adjusting = $event"
      @add-new="addingNew = $event"
      @close="activeMeal = null"
    />

    <PortionSheet
      v-if="adjusting"
      :food="adjusting"
      @confirm="logSuggestion(adjusting!, activeMeal!, $event)"
      @cancel="adjusting = null"
    />

    <EntryDetailSheet
      v-if="viewingEntry"
      :entry="viewingEntry"
      @save="saveEntry(viewingEntry!, $event)"
      @remove="removeEntry(viewingEntry!)"
      @cancel="viewingEntry = null"
    />

    <NewFoodSheet
      v-if="addingNew !== null"
      :initial-query="addingNew"
      @created="onFoodCreated"
      @cancel="addingNew = null"
    />

    <ShareStory v-if="showShare" :date="viewDate" @close="showShare = false" />

    <PhotoMealSheet
      v-if="photoFile"
      :file="photoFile"
      :date="viewDate"
      @close="photoFile = null"
      @logged="onPhotoLogged"
    />

    <SuggestMealSheet
      v-if="showSuggest"
      :meal-type="currentMeal()"
      :date="viewDate"
      @close="showSuggest = false"
      @logged="load"
    />

    <BarcodeScanner
      v-if="showBarcode"
      :meal-type="currentMeal()"
      :date="viewDate"
      @close="showBarcode = false"
      @logged="load"
    />
  </div>
</template>

<style scoped>
.quick {
  width: 100%;
  margin-top: 16px;
  font-size: 16px;
  text-transform: capitalize;
}

.date-nav {
  display: flex;
  align-items: center;
  gap: 2px;
}

.head-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.share-btn {
  width: 40px;
  height: 40px;
  min-height: 40px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: 12px;
  color: var(--accent);
  background: var(--surface);
  border: 1px solid var(--border);
  transition: transform 0.12s ease;
}

.share-btn:active {
  transform: scale(0.92);
}

.nav-btn {
  width: 34px;
  min-height: 40px;
  font-size: 24px;
  color: var(--text-dim);
  border-radius: 8px;
  flex-shrink: 0;
}

.nav-btn:disabled {
  opacity: 0.25;
}

.nav-btn:active:not(:disabled) {
  background: var(--surface-2);
}

.date-label {
  min-width: 0;
}

.date-sub {
  margin: 0;
  font-size: 12px;
}

.hidden-input {
  display: none;
}

.action-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin: 0 0 12px;
}

.mini-cta {
  padding: 12px 8px;
  border-radius: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 14px;
  font-weight: 500;
  transition: border-color 0.12s ease;
}

.mini-cta:active {
  border-color: var(--accent-dim);
}

.snap-cta {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin: 4px 0 12px;
  padding: 14px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(74, 222, 128, 0.14), rgba(90, 209, 255, 0.1));
  border: 1px solid rgba(74, 222, 128, 0.4);
  color: var(--accent);
  font-size: 15px;
  font-weight: 600;
  transition: transform 0.12s ease;
}

.snap-cta em {
  color: var(--text-dim);
  font-style: normal;
  font-weight: 400;
}

.snap-cta:active {
  transform: scale(0.985);
}

.jump-today {
  width: 100%;
  margin-top: 12px;
  padding: 8px;
  font-size: 13px;
  color: var(--accent);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  min-height: 40px;
}

.entry-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-width: 0;
  text-align: left;
  padding: 0;
  min-height: auto;
}

.entry-sub {
  font-size: 13px;
}

.entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px 14px;
  margin-bottom: 8px;
}

.entry-name {
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pending {
  margin-left: 8px;
  color: var(--warn);
  font-size: 12px;
}

.remove {
  flex-shrink: 0;
  width: var(--tap);
  height: var(--tap);
  font-size: 24px;
  color: var(--text-dim);
  border-radius: 10px;
}

.remove:active {
  background: var(--surface-2);
}

.add {
  width: 100%;
  border: 1px dashed var(--border);
  border-radius: 12px;
  padding: 12px;
  color: var(--text-dim);
  font-size: 15px;
}

.add:active {
  background: var(--surface-2);
}
</style>
