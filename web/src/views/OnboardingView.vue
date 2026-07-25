<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import { addDays, todayISO } from '../dates';
import {
  ACTIVITY,
  GOALS,
  calcBMR,
  calcTDEE,
  computeMacros,
  type ActivityLevel,
  type Gender,
  type Goal,
} from '../nutrition';

const router = useRouter();

const STEPS = ['About you', 'Maintenance', 'Your goal', 'Your plan'] as const;
const step = ref(0);
const busy = ref(false);
const error = ref<string | null>(null);

// ── Collected inputs ──────────────────────────────────────
const name = ref('');
const gender = ref<Gender | null>(null);
const age = ref<number | null>(null);
const height = ref<number | null>(null);
const weight = ref<number | null>(null);
const activity = ref<ActivityLevel>('light');
const goal = ref<Goal>('cut');
const targetWeight = ref<number | null>(null);

// ── Derived figures ───────────────────────────────────────
const bmr = computed(() =>
  gender.value && age.value && height.value && weight.value
    ? calcBMR(weight.value, height.value, age.value, gender.value)
    : null
);
const tdee = computed(() => (bmr.value ? calcTDEE(bmr.value, activity.value) : null));
const baseline = computed(() =>
  tdee.value && weight.value ? computeMacros(tdee.value, weight.value, goal.value) : null
);

/** A safe target date for the glide plan, derived from a healthy weekly rate. */
const targetDate = computed(() => {
  if (!weight.value || !targetWeight.value || goal.value === 'maintain') return null;
  const perWeek = goal.value === 'cut' ? 0.55 : goal.value === 'lean_bulk' ? 0.2 : 0.35;
  const weeks = Math.abs(targetWeight.value - weight.value) / perWeek;
  if (weeks < 1) return null;
  return addDays(todayISO(), Math.round(weeks * 7));
});

const step0Valid = computed(
  () =>
    name.value.trim().length > 0 &&
    gender.value !== null &&
    !!age.value &&
    age.value >= 13 &&
    !!height.value &&
    height.value >= 120 &&
    !!weight.value &&
    weight.value >= 30
);

// ── AI / final plan state ─────────────────────────────────
const aiLoading = ref(false);
const aiUsed = ref(false);
const summary = ref('');
const plan = ref({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });

function fallbackSummary(): string {
  const g = GOALS[goal.value];
  return (
    `${name.value.trim()} is focused on ${g.label.toLowerCase()} — ${g.blurb.toLowerCase()}. ` +
    `Maintenance is about ${tdee.value} kcal/day; the daily target is ${plan.value.calories} kcal ` +
    `with ${plan.value.protein_g}g protein, ${plan.value.carbs_g}g carbs and ${plan.value.fat_g}g fat. ` +
    `Prioritise hitting protein every day and staying near the calorie target. Eats mostly Indian home-cooked food.`
  );
}

/** Entering the plan step: seed with the baseline, then try to refine via AI. */
async function loadPlan(): Promise<void> {
  if (!baseline.value || !tdee.value || !bmr.value) return;
  plan.value = { ...baseline.value };
  aiLoading.value = true;
  aiUsed.value = false;
  try {
    const ai = await api.aiPlan({
      display_name: name.value.trim(),
      gender: gender.value,
      age: age.value,
      height_cm: height.value,
      weight_kg: weight.value,
      activity_level: activity.value,
      goal: goal.value,
      target_weight_kg: targetWeight.value,
      bmr: bmr.value,
      tdee: tdee.value,
      baseline: baseline.value,
    });
    if (ai) {
      plan.value = {
        calories: ai.daily_calorie_goal,
        protein_g: ai.daily_protein_goal_g,
        carbs_g: ai.daily_carbs_goal_g,
        fat_g: ai.daily_fat_goal_g,
      };
      summary.value = ai.summary;
      aiUsed.value = true;
    } else {
      summary.value = fallbackSummary();
    }
  } catch {
    summary.value = fallbackSummary();
  } finally {
    aiLoading.value = false;
  }
}

async function next(): Promise<void> {
  error.value = null;
  if (step.value === 0 && !step0Valid.value) {
    error.value = 'Fill in your details to continue.';
    return;
  }
  if (step.value < STEPS.length - 1) {
    step.value += 1;
    if (step.value === 3) void loadPlan();
    window.scrollTo({ top: 0 });
  }
}

function back(): void {
  error.value = null;
  if (step.value > 0) step.value -= 1;
}

async function finish(): Promise<void> {
  error.value = null;
  if (plan.value.calories < 800) {
    error.value = 'Calorie target looks too low.';
    return;
  }
  busy.value = true;
  try {
    await api.completeOnboarding({
      display_name: name.value.trim() || 'You',
      gender: gender.value,
      age: age.value,
      height_cm: height.value,
      weight_kg: weight.value,
      activity_level: activity.value,
      goal: goal.value,
      daily_calorie_goal: Math.round(plan.value.calories),
      daily_protein_goal_g: Math.round(plan.value.protein_g),
      daily_carbs_goal_g: Math.round(plan.value.carbs_g),
      daily_fat_goal_g: Math.round(plan.value.fat_g),
      behavior_instructions: summary.value || fallbackSummary(),
      target_weight_kg: targetWeight.value,
      target_date: targetDate.value,
    });
    router.replace('/');
  } catch {
    error.value = "Couldn't save. Check your connection and try again.";
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  try {
    const me = await api.me();
    if (me.onboarded) {
      router.replace('/');
      return;
    }
    name.value = me.name && me.name !== 'You' ? me.name : '';
  } catch {
    router.replace('/login');
  }
});
</script>

<template>
  <div class="onboard">
    <!-- Progress -->
    <div class="progress">
      <div v-for="(s, i) in STEPS" :key="s" class="seg" :class="{ done: i <= step }"></div>
    </div>
    <p class="stepnum mono">Step {{ step + 1 }} of {{ STEPS.length }} · {{ STEPS[step] }}</p>

    <!-- ── Step 0: About you ──────────────────────────── -->
    <section v-if="step === 0">
      <h1>Let's set you up</h1>
      <p class="sub">A few basics so I can work out your calories and macros.</p>

      <div class="field">
        <label>What should I call you?</label>
        <input v-model="name" type="text" placeholder="Your name" autocomplete="given-name" />
      </div>

      <div class="field">
        <label>Sex (for the calorie formula)</label>
        <div class="seg-btns">
          <button
            v-for="opt in (['male', 'female'] as const)"
            :key="opt"
            type="button"
            class="segbtn"
            :class="{ active: gender === opt }"
            @click="gender = opt"
          >
            {{ opt === 'male' ? 'Male' : 'Female' }}
          </button>
        </div>
      </div>

      <div class="grid3">
        <div class="field">
          <label>Age</label>
          <input v-model.number="age" type="number" inputmode="numeric" placeholder="27" />
        </div>
        <div class="field">
          <label>Height (cm)</label>
          <input v-model.number="height" type="number" inputmode="numeric" placeholder="175" />
        </div>
        <div class="field">
          <label>Weight (kg)</label>
          <input v-model.number="weight" type="number" inputmode="decimal" step="0.1" placeholder="72" />
        </div>
      </div>

      <div class="field">
        <label>How active are you?</label>
        <div class="stack">
          <button
            v-for="(a, key) in ACTIVITY"
            :key="key"
            type="button"
            class="opt"
            :class="{ active: activity === key }"
            @click="activity = key as ActivityLevel"
          >
            <span class="opt-title">{{ a.label }}</span>
            <span class="opt-hint">{{ a.hint }}</span>
          </button>
        </div>
      </div>
    </section>

    <!-- ── Step 1: Maintenance ────────────────────────── -->
    <section v-else-if="step === 1">
      <h1>Your maintenance</h1>
      <p class="sub">This is roughly what your body burns in a day at your activity level.</p>

      <div class="maint-card">
        <div class="maint-big mono">{{ tdee?.toLocaleString() ?? '—' }}</div>
        <div class="maint-unit">kcal / day to maintain</div>
        <div class="maint-row">
          <span>Resting (BMR)</span>
          <span class="mono">{{ bmr?.toLocaleString() ?? '—' }} kcal</span>
        </div>
        <div class="maint-row">
          <span>Activity</span>
          <span>{{ ACTIVITY[activity].label }} ×{{ ACTIVITY[activity].mult }}</span>
        </div>
      </div>
      <p class="note">
        Eat around this to hold weight, less to lose fat, more to gain muscle. You'll pick a goal
        next.
      </p>
    </section>

    <!-- ── Step 2: Goal ───────────────────────────────── -->
    <section v-else-if="step === 2">
      <h1>Pick your goal</h1>
      <p class="sub">I'll turn your maintenance into a daily calorie and macro target.</p>

      <div class="stack">
        <button
          v-for="(g, key) in GOALS"
          :key="key"
          type="button"
          class="goal-card"
          :class="{ active: goal === key }"
          @click="goal = key as Goal"
        >
          <div class="goal-head">
            <span class="goal-name">{{ g.label }}</span>
            <span class="goal-kcal mono">
              {{ tdee ? computeMacros(tdee, weight ?? 70, key as Goal).calories.toLocaleString() : '—' }}
              <u>kcal</u>
            </span>
          </div>
          <span class="goal-blurb">{{ g.blurb }}</span>
        </button>
      </div>

      <div v-if="goal !== 'maintain'" class="field target-field">
        <label>Goal weight (kg) — optional, sets your Plan tab glide path</label>
        <input
          v-model.number="targetWeight"
          type="number"
          inputmode="decimal"
          step="0.1"
          :placeholder="goal === 'cut' ? 'e.g. 68' : 'e.g. 78'"
        />
        <p v-if="targetDate" class="target-hint mono">
          Projected: {{ weight?.toFixed(1) }} → {{ targetWeight?.toFixed(1) }} kg by {{ targetDate }}
        </p>
      </div>
    </section>

    <!-- ── Step 3: Plan ───────────────────────────────── -->
    <section v-else-if="step === 3">
      <h1>Your plan</h1>
      <p class="sub">
        {{ aiUsed ? 'Personalised by your AI coach.' : 'Your daily targets — tweak any of them.' }}
      </p>

      <div v-if="aiLoading" class="ai-loading card">
        <div class="spinner"></div>
        <p>Your coach is building a personalised plan…</p>
      </div>

      <template v-else>
        <div class="macro-grid">
          <label class="macro cal">
            <span class="macro-lab">Calories</span>
            <input v-model.number="plan.calories" type="number" inputmode="numeric" />
          </label>
          <label class="macro pro">
            <span class="macro-lab">Protein (g)</span>
            <input v-model.number="plan.protein_g" type="number" inputmode="numeric" />
          </label>
          <label class="macro car">
            <span class="macro-lab">Carbs (g)</span>
            <input v-model.number="plan.carbs_g" type="number" inputmode="numeric" />
          </label>
          <label class="macro fat">
            <span class="macro-lab">Fat (g)</span>
            <input v-model.number="plan.fat_g" type="number" inputmode="numeric" />
          </label>
        </div>

        <div v-if="summary" class="coach-note">
          <div class="coach-note-head">
            <span class="coach-ava">🥗</span> Your coach's notes
          </div>
          <p>{{ summary }}</p>
        </div>
      </template>
    </section>

    <p v-if="error" class="error">{{ error }}</p>

    <!-- Nav -->
    <div class="nav">
      <button v-if="step > 0" class="btn btn-ghost" type="button" :disabled="busy" @click="back">
        Back
      </button>
      <button
        v-if="step < 3"
        class="btn grow"
        type="button"
        :disabled="step === 0 && !step0Valid"
        @click="next"
      >
        Continue
      </button>
      <button
        v-else
        class="btn grow"
        type="button"
        :disabled="busy || aiLoading"
        @click="finish"
      >
        {{ busy ? 'Saving…' : 'Start tracking' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.onboard {
  max-width: 480px;
  margin: 0 auto;
  padding: 20px 20px calc(32px + env(safe-area-inset-bottom));
  padding-top: calc(20px + env(safe-area-inset-top));
}

.progress {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}

.seg {
  flex: 1;
  height: 4px;
  border-radius: 4px;
  background: var(--surface-2);
  transition: background 0.25s ease;
}

.seg.done {
  background: var(--accent);
}

.stepnum {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-dim);
  margin: 0 0 18px;
}

h1 {
  font-size: 25px;
  margin: 0 0 6px;
  letter-spacing: -0.01em;
}

.sub {
  color: var(--text-dim);
  font-size: 14px;
  margin: 0 0 22px;
}

.field {
  margin-bottom: 18px;
}

.field > label {
  display: block;
  font-size: 13px;
  color: var(--text-dim);
  margin-bottom: 7px;
}

.grid3 {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.grid3 .field {
  margin-bottom: 18px;
}

/* Segmented buttons (sex) */
.seg-btns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.segbtn {
  padding: 12px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 12px;
  color: var(--text);
  font-size: 15px;
}

.segbtn.active {
  border-color: var(--accent);
  color: var(--accent);
  background: rgba(74, 222, 128, 0.08);
}

/* Stacked option rows (activity, goals) */
.stack {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.opt {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  padding: 12px 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  gap: 2px;
}

.opt.active {
  border-color: var(--accent);
  background: rgba(74, 222, 128, 0.06);
}

.opt-title {
  font-size: 15px;
  color: var(--text);
  font-weight: 500;
}

.opt-hint {
  font-size: 12px;
  color: var(--text-dim);
}

/* Maintenance card */
.maint-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 22px 18px;
  text-align: center;
  margin-bottom: 14px;
}

.maint-big {
  font-size: 46px;
  font-weight: 800;
  color: var(--accent);
  line-height: 1;
}

.maint-unit {
  font-size: 13px;
  color: var(--text-dim);
  margin: 6px 0 16px;
}

.maint-row {
  display: flex;
  justify-content: space-between;
  font-size: 14px;
  padding: 9px 0;
  border-top: 1px solid var(--border);
  color: var(--text-dim);
}

.maint-row span:last-child {
  color: var(--text);
}

.note {
  font-size: 13px;
  color: var(--text-dim);
  line-height: 1.5;
  margin: 0;
}

/* Goal cards */
.goal-card {
  display: flex;
  flex-direction: column;
  text-align: left;
  padding: 14px 15px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  gap: 3px;
}

.goal-card.active {
  border-color: var(--accent);
  background: rgba(74, 222, 128, 0.06);
}

.goal-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.goal-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}

.goal-kcal {
  font-size: 17px;
  font-weight: 700;
  color: var(--accent);
}

.goal-kcal u {
  font-size: 11px;
  text-decoration: none;
  color: var(--text-dim);
  font-weight: 400;
}

.goal-blurb {
  font-size: 13px;
  color: var(--text-dim);
}

.target-field {
  margin-top: 18px;
}

.target-hint {
  font-size: 12px;
  color: var(--accent);
  margin: 8px 0 0;
}

/* Plan step */
.ai-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 40px 20px;
  text-align: center;
  color: var(--text-dim);
  font-size: 14px;
}

.spinner {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 3px solid var(--surface-2);
  border-top-color: var(--accent);
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.macro-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 16px;
}

.macro {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px 13px;
  position: relative;
  overflow: hidden;
}

.macro::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--stripe, var(--accent));
}

.macro.cal {
  --stripe: #5ad1ff;
}
.macro.pro {
  --stripe: var(--accent);
}
.macro.car {
  --stripe: var(--warn);
}
.macro.fat {
  --stripe: #a98bff;
}

.macro-lab {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-dim);
}

.macro input {
  border: none;
  background: transparent;
  padding: 0;
  font-size: 24px;
  font-weight: 700;
  min-height: auto;
}

.macro input:focus {
  outline: none;
}

.coach-note {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 14px 16px;
}

.coach-note-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 8px;
}

.coach-ava {
  font-size: 15px;
}

.coach-note p {
  margin: 0;
  font-size: 14px;
  line-height: 1.55;
  color: var(--text);
}

.error {
  color: var(--danger);
  font-size: 13px;
  margin: 16px 0 0;
}

.nav {
  display: flex;
  gap: 10px;
  margin-top: 26px;
}

.grow {
  flex: 1;
}
</style>
