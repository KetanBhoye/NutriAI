<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';
import { fileToDataUrl } from '../image';
import type { MealType } from '../api';

const props = defineProps<{ file: File; date: string }>();
const emit = defineEmits<{ close: []; logged: [] }>();

interface Item {
  food_name: string;
  quantity: number;
  unit: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

const previewUrl = ref<string | null>(null);
const status = ref<'analyzing' | 'review' | 'notfood' | 'error' | 'saving'>('analyzing');
const note = ref('');
const items = ref<Item[]>([]);
const mealType = ref<MealType>(defaultMeal());
const errorMsg = ref<string | null>(null);

const MEALS: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

function defaultMeal(): MealType {
  const h = new Date().getHours();
  if (h < 11) return 'breakfast';
  if (h < 16) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snack';
}

const totals = computed(() =>
  items.value.reduce(
    (a, it) => ({ cal: a.cal + (it.calories || 0), pro: a.pro + (it.protein_g || 0) }),
    { cal: 0, pro: 0 }
  )
);

async function analyze(): Promise<void> {
  status.value = 'analyzing';
  errorMsg.value = null;
  try {
    const dataUrl = await fileToDataUrl(props.file);
    previewUrl.value = dataUrl;
    const result = await api.photoParse(dataUrl);
    if (!result.understood || result.items.length === 0) {
      note.value = result.note || '';
      status.value = 'notfood';
      return;
    }
    note.value = result.note;
    items.value = result.items.map((i) => ({ ...i }));
    status.value = 'review';
  } catch (e) {
    errorMsg.value = e instanceof Error && e.message && !e.message.startsWith('{') ? e.message : null;
    status.value = 'error';
  }
}

function removeItem(i: number): void {
  items.value.splice(i, 1);
  if (items.value.length === 0) status.value = 'notfood';
}

async function logAll(): Promise<void> {
  if (items.value.length === 0) return;
  status.value = 'saving';
  try {
    for (const it of items.value) {
      const label =
        it.quantity && it.unit ? `${it.food_name} (${trimNum(it.quantity)} ${it.unit})` : it.food_name;
      await fetch('/api/entries', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          food_name: label,
          calories: Math.round(it.calories) || 0,
          protein_g: it.protein_g || 0,
          carbs_g: it.carbs_g || 0,
          fat_g: it.fat_g || 0,
          meal_type: mealType.value,
          entry_date: props.date,
          quantity: it.quantity || undefined,
          unit: it.unit || undefined,
        }),
      });
    }
    if (navigator.vibrate) navigator.vibrate(10);
    emit('logged');
  } catch {
    errorMsg.value = 'Some items failed to save. Check your connection.';
    status.value = 'review';
  }
}

function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

onMounted(analyze);
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="sheet">
      <div class="sheet-head">
        <span class="sheet-title">📸 Snap a meal</span>
        <button class="x" aria-label="Close" @click="emit('close')">✕</button>
      </div>

      <div class="body">
        <div v-if="previewUrl" class="thumb-wrap">
          <img :src="previewUrl" class="thumb" alt="Your meal" />
          <div v-if="status === 'analyzing'" class="scan"><div class="scan-line"></div></div>
        </div>

        <!-- Analyzing -->
        <div v-if="status === 'analyzing'" class="center">
          <div class="spin"></div>
          <p>Reading your plate…</p>
        </div>

        <!-- Error -->
        <div v-else-if="status === 'error'" class="center">
          <p>{{ errorMsg ?? "Couldn't read the photo." }}</p>
          <div class="btnrow">
            <button class="btn btn-ghost" @click="emit('close')">Close</button>
            <button class="btn" @click="analyze">Try again</button>
          </div>
        </div>

        <!-- Not food -->
        <div v-else-if="status === 'notfood'" class="center">
          <p>I couldn't find food in that photo.</p>
          <p v-if="note" class="muted small">{{ note }}</p>
          <div class="btnrow">
            <button class="btn btn-ghost" @click="emit('close')">Close</button>
            <button class="btn" @click="analyze">Retry</button>
          </div>
        </div>

        <!-- Review -->
        <template v-else>
          <p v-if="note" class="note">{{ note }}</p>

          <div class="meal-tabs">
            <button
              v-for="m in MEALS"
              :key="m"
              class="meal-tab"
              :class="{ active: mealType === m }"
              @click="mealType = m"
            >
              {{ m }}
            </button>
          </div>

          <div class="items">
            <div v-for="(it, i) in items" :key="i" class="item">
              <div class="item-top">
                <input v-model="it.food_name" class="name-in" type="text" />
                <button class="rm" aria-label="Remove" @click="removeItem(i)">✕</button>
              </div>
              <div class="item-fields">
                <label class="mini">
                  <span>Qty</span>
                  <input v-model.number="it.quantity" type="number" step="0.5" inputmode="decimal" />
                </label>
                <label class="mini unit">
                  <span>Unit</span>
                  <input v-model="it.unit" type="text" />
                </label>
                <label class="mini">
                  <span>Kcal</span>
                  <input v-model.number="it.calories" type="number" inputmode="numeric" />
                </label>
                <label class="mini">
                  <span>Protein</span>
                  <input v-model.number="it.protein_g" type="number" inputmode="numeric" />
                </label>
              </div>
            </div>
          </div>

          <div class="totalbar">
            <span><strong>{{ Math.round(totals.cal) }}</strong> kcal</span>
            <span><strong>{{ Math.round(totals.pro) }}</strong>g protein</span>
          </div>
          <p class="muted small disclaimer">AI estimate — tweak anything before logging.</p>

          <button class="btn wide" :disabled="status === 'saving' || items.length === 0" @click="logAll">
            {{ status === 'saving' ? 'Logging…' : `Log ${items.length} item${items.length === 1 ? '' : 's'} to ${mealType}` }}
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.sheet {
  width: 100%;
  max-width: 480px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 20px 20px 0 0;
  max-height: 94dvh;
  display: flex;
  flex-direction: column;
}

.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
  flex-shrink: 0;
}

.sheet-title {
  font-size: 16px;
  font-weight: 600;
}

.x {
  width: 34px;
  min-height: 34px;
  color: var(--text-dim);
  border-radius: 8px;
}

.body {
  overflow-y: auto;
  padding: 0 16px calc(18px + env(safe-area-inset-bottom));
}

.thumb-wrap {
  position: relative;
  border-radius: 14px;
  overflow: hidden;
  margin-bottom: 14px;
}

.thumb {
  width: 100%;
  max-height: 220px;
  object-fit: cover;
  display: block;
}

.scan {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.scan-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  box-shadow: 0 0 16px 2px var(--accent);
  animation: scan 1.4s ease-in-out infinite;
}

@keyframes scan {
  0%, 100% { top: 4%; }
  50% { top: 92%; }
}

.center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 24px 0 8px;
  color: var(--text-dim);
  font-size: 14px;
  text-align: center;
}

.spin {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 3px solid var(--surface-2);
  border-top-color: var(--accent);
  animation: spinr 0.8s linear infinite;
}

@keyframes spinr {
  to { transform: rotate(360deg); }
}

.note {
  font-size: 14px;
  color: var(--text);
  margin: 0 0 12px;
  line-height: 1.4;
}

.meal-tabs {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  margin-bottom: 14px;
}

.meal-tab {
  padding: 9px 4px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  color: var(--text-dim);
  font-size: 13px;
  text-transform: capitalize;
}

.meal-tab.active {
  border-color: var(--accent);
  color: var(--accent);
  background: rgba(74, 222, 128, 0.08);
}

.items {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.item {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px 12px;
}

.item-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.name-in {
  flex: 1;
  background: transparent;
  border: none;
  color: var(--text);
  font-size: 15px;
  font-weight: 500;
  padding: 2px 0;
  min-height: auto;
}

.name-in:focus {
  outline: none;
}

.rm {
  width: 28px;
  min-height: 28px;
  color: var(--text-dim);
  font-size: 13px;
  flex-shrink: 0;
}

.item-fields {
  display: grid;
  grid-template-columns: 1fr 1.1fr 1fr 1fr;
  gap: 8px;
}

.mini {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.mini span {
  font-size: 10px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.mini input {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 8px;
  font-size: 14px;
  min-height: 40px;
  width: 100%;
}

.totalbar {
  display: flex;
  justify-content: center;
  gap: 20px;
  margin: 16px 0 2px;
  font-size: 15px;
  color: var(--text);
}

.totalbar strong {
  color: var(--accent);
}

.small {
  font-size: 12px;
}

.disclaimer {
  text-align: center;
  margin: 4px 0 12px;
}

.wide {
  width: 100%;
}

.btnrow {
  display: flex;
  gap: 10px;
  margin-top: 6px;
}

.btnrow .btn {
  flex: 1;
}
</style>
