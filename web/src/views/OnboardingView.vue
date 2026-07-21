<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';

const router = useRouter();
const name = ref('');
const busy = ref(false);
const error = ref<string | null>(null);

/** A light goal calculator so the user isn't staring at blank fields. */
const preset = ref<'lose' | 'maintain' | 'gain'>('lose');
const bodyweight = ref<number | null>(null);

const goals = computed(() => {
  const kg = bodyweight.value && bodyweight.value > 0 ? bodyweight.value : 75;
  // Rough, transparent starting points — the user can override every field.
  const perKgCals = preset.value === 'lose' ? 26 : preset.value === 'gain' ? 38 : 32;
  const calories = Math.round((kg * perKgCals) / 10) * 10;
  const protein = Math.round(kg * 2);
  const fat = Math.round((calories * 0.28) / 9);
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
  return { calories, protein, carbs, fat };
});

// Editable copies so the user can fine-tune after picking a preset.
const form = ref({ calories: 0, protein: 0, carbs: 0, fat: 0 });
const touched = ref(false);

function applyPreset(): void {
  if (touched.value) return; // don't clobber manual edits
  form.value = {
    calories: goals.value.calories,
    protein: goals.value.protein,
    carbs: goals.value.carbs,
    fat: goals.value.fat,
  };
}

onMounted(async () => {
  try {
    const me = await api.me();
    if (me.onboarded) {
      router.replace('/');
      return;
    }
    name.value = me.name ?? '';
  } catch {
    router.replace('/login');
    return;
  }
  applyPreset();
});

async function save(): Promise<void> {
  error.value = null;
  if (form.value.calories < 800) {
    error.value = 'Set a daily calorie target of at least 800.';
    return;
  }
  busy.value = true;
  try {
    await api.saveOnboarding({
      display_name: name.value.trim() || 'You',
      daily_calorie_goal: Math.round(form.value.calories),
      daily_protein_goal_g: Math.round(form.value.protein),
      daily_carbs_goal_g: Math.round(form.value.carbs),
      daily_fat_goal_g: Math.round(form.value.fat),
    });
    router.replace('/');
  } catch {
    error.value = "Couldn't save. Check your connection and try again.";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="onboard">
    <header>
      <p class="eyebrow">Set up</p>
      <h1>Your daily targets</h1>
      <p class="muted sub">
        These drive the progress rings on your Today tab. Change them any time — nothing here is
        permanent.
      </p>
    </header>

    <div class="field">
      <label>What should I call you?</label>
      <input v-model="name" type="text" placeholder="Your name" />
    </div>

    <div class="field">
      <label>Your weight (kg) — optional, just for a starting estimate</label>
      <input
        v-model.number="bodyweight"
        type="number"
        inputmode="decimal"
        placeholder="e.g. 72"
        @input="applyPreset"
      />
    </div>

    <div class="field">
      <label>Goal</label>
      <div class="presets">
        <button
          v-for="p in (['lose', 'maintain', 'gain'] as const)"
          :key="p"
          class="preset"
          :class="{ active: preset === p }"
          type="button"
          @click="preset = p; applyPreset()"
        >
          {{ p === 'lose' ? 'Lose fat' : p === 'gain' ? 'Build muscle' : 'Maintain' }}
        </button>
      </div>
    </div>

    <div class="card targets">
      <div class="grid2">
        <label class="t">Calories<input v-model.number="form.calories" type="number" inputmode="numeric" @input="touched = true" /></label>
        <label class="t">Protein (g)<input v-model.number="form.protein" type="number" inputmode="numeric" @input="touched = true" /></label>
        <label class="t">Carbs (g)<input v-model.number="form.carbs" type="number" inputmode="numeric" @input="touched = true" /></label>
        <label class="t">Fat (g)<input v-model.number="form.fat" type="number" inputmode="numeric" @input="touched = true" /></label>
      </div>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <button class="btn wide" :disabled="busy" @click="save">
      {{ busy ? 'Saving…' : 'Start tracking' }}
    </button>
  </div>
</template>

<style scoped>
.onboard {
  max-width: 480px;
  margin: 0 auto;
  padding: 24px 20px calc(40px + env(safe-area-inset-bottom));
  padding-top: calc(28px + env(safe-area-inset-top));
}

.eyebrow {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--accent);
  margin: 0 0 8px;
}

h1 {
  font-size: 26px;
  margin: 0 0 8px;
}

.sub {
  font-size: 14px;
  margin: 0 0 24px;
}

.field {
  margin-bottom: 16px;
}

.field label {
  display: block;
  font-size: 13px;
  color: var(--text-dim);
  margin-bottom: 6px;
}

.presets {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.preset {
  padding: 12px 6px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 12px;
  font-size: 14px;
  color: var(--text);
}

.preset.active {
  border-color: var(--accent);
  color: var(--accent);
}

.targets {
  padding: 16px;
  margin-bottom: 16px;
}

.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.t {
  display: flex;
  flex-direction: column;
  font-size: 12px;
  color: var(--text-dim);
  gap: 6px;
}

.wide {
  width: 100%;
}

.error {
  color: var(--danger);
  font-size: 13px;
  margin: 0 0 12px;
}
</style>
