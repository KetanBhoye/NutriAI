<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';
import type { MealType } from '../api';

const props = defineProps<{ mealType: MealType; date: string }>();
const emit = defineEmits<{ close: []; logged: [] }>();

interface Suggestion {
  name: string;
  description: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

const status = ref<'loading' | 'ready' | 'error'>('loading');
const suggestions = ref<Suggestion[]>([]);
const remaining = ref<{ cal: number | null; pro: number | null }>({ cal: null, pro: null });
const loggedIdx = ref<Set<number>>(new Set());
const busyIdx = ref<number | null>(null);

async function load(): Promise<void> {
  status.value = 'loading';
  loggedIdx.value = new Set();
  try {
    const res = await api.suggestMeal(props.mealType);
    suggestions.value = res.suggestions;
    remaining.value = { cal: res.remaining_calories, pro: res.remaining_protein };
    status.value = suggestions.value.length ? 'ready' : 'error';
  } catch {
    status.value = 'error';
  }
}

async function logIt(s: Suggestion, i: number): Promise<void> {
  busyIdx.value = i;
  try {
    await fetch('/api/entries', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        food_name: s.name,
        calories: Math.round(s.calories) || 0,
        protein_g: s.protein_g || 0,
        carbs_g: s.carbs_g || 0,
        fat_g: s.fat_g || 0,
        meal_type: props.mealType,
        entry_date: props.date,
      }),
    });
    loggedIdx.value = new Set([...loggedIdx.value, i]);
    if (navigator.vibrate) navigator.vibrate(8);
    emit('logged');
  } finally {
    busyIdx.value = null;
  }
}

onMounted(load);
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="sheet">
      <div class="sheet-head">
        <span class="sheet-title">🍽️ What should I eat?</span>
        <button class="x" aria-label="Close" @click="emit('close')">✕</button>
      </div>

      <div class="body">
        <p v-if="remaining.cal !== null" class="sub muted">
          For {{ mealType }} · about <strong>{{ remaining.cal }} kcal</strong> left today<template
            v-if="remaining.pro !== null && remaining.pro > 0"
          >
            · {{ remaining.pro }}g protein to go</template
          >
        </p>

        <div v-if="status === 'loading'" class="center">
          <div class="spin"></div>
          <p>Thinking of simple options…</p>
        </div>

        <div v-else-if="status === 'error'" class="center">
          <p>Couldn't get suggestions.</p>
          <button class="btn btn-ghost" @click="load">Try again</button>
        </div>

        <template v-else>
          <div class="cards">
            <div v-for="(s, i) in suggestions" :key="i" class="scard">
              <div class="s-top">
                <span class="s-name">{{ s.name }}</span>
                <span class="s-cal mono">{{ s.calories }} kcal</span>
              </div>
              <p class="s-desc">{{ s.description }}</p>
              <div class="s-bottom">
                <span class="s-macros mono">{{ s.protein_g }}g P · {{ s.carbs_g }}g C · {{ s.fat_g }}g F</span>
                <button
                  v-if="!loggedIdx.has(i)"
                  class="s-log"
                  :disabled="busyIdx === i"
                  @click="logIt(s, i)"
                >
                  {{ busyIdx === i ? '…' : '+ Log' }}
                </button>
                <span v-else class="s-done">✓ Logged</span>
              </div>
            </div>
          </div>

          <button class="btn btn-ghost wide regen" @click="load">↻ Suggest others</button>
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
  max-height: 92dvh;
  display: flex;
  flex-direction: column;
}

.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 6px;
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

.sub {
  font-size: 13px;
  margin: 0 0 14px;
}

.center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px 0 8px;
  color: var(--text-dim);
  font-size: 14px;
}

.spin {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 3px solid var(--surface-2);
  border-top-color: var(--accent);
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.scard {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 13px 15px;
}

.s-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 5px;
}

.s-name {
  font-size: 15.5px;
  font-weight: 600;
}

.s-cal {
  font-size: 13px;
  color: var(--accent);
  flex-shrink: 0;
}

.s-desc {
  font-size: 13.5px;
  color: var(--text-dim);
  line-height: 1.4;
  margin: 0 0 10px;
}

.s-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.s-macros {
  font-size: 12px;
  color: var(--text-dim);
}

.s-log {
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 600;
  color: #06210f;
  background: var(--accent);
  border-radius: 9px;
  padding: 7px 14px;
  min-height: 34px;
}

.s-done {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
}

.wide {
  width: 100%;
}

.regen {
  margin-top: 14px;
}
</style>
