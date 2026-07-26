<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { addDays, todayISO } from '../dates';
import { api } from '../api';
import GlideChart from '../components/GlideChart.vue';
import {
  ACTIVITY,
  GOALS,
  RATE_OPTIONS,
  calcBMR,
  calcTDEE,
  computeMacros,
  dailyDelta,
  defaultRate,
  type ActivityLevel,
  type Goal,
} from '../nutrition';

interface GlideWeek {
  week: number;
  date: string;
  target_kg: number;
  actual_kg: number | null;
  status: 'ahead' | 'on' | 'watch' | 'behind' | 'empty';
}

interface GoalsPayload {
  plan: {
    start_weight_kg: number;
    start_date: string;
    goal_weight_kg: number;
    target_date: string;
    tolerance_kg: number;
    daily_step_goal: number | null;
    weekly_training_days: number | null;
  } | null;
  macros: {
    calories: number | null;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
  };
  glide_path: GlideWeek[];
  weekly_deficit: Array<{
    week_start: string;
    days_logged: number;
    total_deficit: number;
    projected_kg: number;
  }>;
  latest_weight: number | null;
  activity: Array<{ activity_date: string; steps: number | null; active_energy_kcal: number | null }>;
}

const data = ref<GoalsPayload | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const editing = ref(false);
const saving = ref(false);

// ── Intelligent plan editor (mirrors onboarding) ──────────
interface Profile {
  height_cm: number | null;
  age: number | null;
  gender: 'male' | 'female' | null;
  activity_level: ActivityLevel | null;
}
const profile = ref<Profile | null>(null);
const editGoal = ref<Goal>('cut');
const editRate = ref<number>(defaultRate('cut'));
const editWeight = ref<number>(70);
const editActivity = ref<ActivityLevel>('light');
const editTargetWeight = ref<number | null>(null);
const showAdvanced = ref(false);
const aiBusy = ref(false);
const aiNote = ref<string | null>(null);

/** Have enough profile data to auto-calculate targets from goal + rate? */
const canCompute = computed(
  () => !!profile.value?.height_cm && !!profile.value?.age && !!profile.value?.gender
);

const editTdee = computed(() => {
  if (!canCompute.value) return null;
  const p = profile.value!;
  const bmr = calcBMR(editWeight.value, p.height_cm!, p.age!, p.gender!);
  return calcTDEE(bmr, editActivity.value);
});

const editMacros = computed(() =>
  editTdee.value ? computeMacros(editTdee.value, editWeight.value, editGoal.value, editRate.value) : null
);

const editDelta = computed(() =>
  editGoal.value === 'maintain' ? 0 : dailyDelta(editRate.value)
);

const editRateOptions = computed(() => RATE_OPTIONS[editGoal.value]);

function pickEditGoal(g: Goal): void {
  editGoal.value = g;
  editRate.value = defaultRate(g);
  aiNote.value = null;
}

/** Push the auto-computed plan into the form model that save() sends. */
function syncFormFromEditor(): void {
  const m = editMacros.value;
  if (!m) return;
  form.value.start_weight_kg = editWeight.value;
  form.value.start_date = todayISO();
  // Goal weight: user's target, or (for maintain / no target) hold current.
  const goalW = editGoal.value === 'maintain' ? editWeight.value : editTargetWeight.value ?? editWeight.value;
  form.value.goal_weight_kg = goalW;
  // Target date from the chosen weekly rate; sensible fallback otherwise.
  if (editGoal.value !== 'maintain' && editTargetWeight.value && editRate.value > 0) {
    const weeks = Math.max(1, Math.abs(editTargetWeight.value - editWeight.value) / editRate.value);
    form.value.target_date = addDays(todayISO(), Math.round(weeks * 7));
  } else {
    form.value.target_date = addDays(todayISO(), 56);
  }
  form.value.daily_calorie_goal = m.calories;
  form.value.daily_protein_goal_g = m.protein_g;
  form.value.daily_carbs_goal_g = m.carbs_g;
  form.value.daily_fat_goal_g = m.fat_g;
}

// Keep the form in sync as the smart controls change.
watch([editGoal, editRate, editWeight, editActivity, editTargetWeight], () => {
  if (canCompute.value) syncFormFromEditor();
});

/** Open the editor: fetch profile and seed the smart controls from the plan. */
async function openEditor(): Promise<void> {
  editing.value = true;
  aiNote.value = null;
  try {
    const res = await fetch('/api/profile', { credentials: 'same-origin' });
    profile.value = res.ok ? ((await res.json()) as Profile) : null;
  } catch {
    profile.value = null;
  }
  const plan = data.value?.plan;
  editWeight.value = data.value?.latest_weight ?? plan?.start_weight_kg ?? 70;
  editActivity.value = profile.value?.activity_level ?? 'light';
  // Infer goal direction from the existing plan.
  if (plan) {
    editGoal.value =
      plan.goal_weight_kg < plan.start_weight_kg
        ? 'cut'
        : plan.goal_weight_kg > plan.start_weight_kg
          ? 'lean_bulk'
          : 'maintain';
    editTargetWeight.value = plan.goal_weight_kg === plan.start_weight_kg ? null : plan.goal_weight_kg;
  } else {
    editGoal.value = 'cut';
    editTargetWeight.value = null;
  }
  editRate.value = defaultRate(editGoal.value);
  if (canCompute.value) syncFormFromEditor();
}

/** Ask the AI coach to refine the computed targets (same endpoint as onboarding). */
async function refineWithAI(): Promise<void> {
  if (!editTdee.value || !editMacros.value || !profile.value) return;
  aiBusy.value = true;
  aiNote.value = null;
  try {
    const p = profile.value;
    const bmr = calcBMR(editWeight.value, p.height_cm!, p.age!, p.gender!);
    const ai = await api.aiPlan({
      display_name: '',
      gender: p.gender,
      age: p.age,
      height_cm: p.height_cm,
      weight_kg: editWeight.value,
      activity_level: editActivity.value,
      goal: editGoal.value,
      target_weight_kg: editTargetWeight.value,
      target_rate_kg_per_week: editRate.value || null,
      bmr,
      tdee: editTdee.value,
      baseline: {
        calories: editMacros.value.calories,
        protein_g: editMacros.value.protein_g,
        carbs_g: editMacros.value.carbs_g,
        fat_g: editMacros.value.fat_g,
      },
    });
    if (ai) {
      form.value.daily_calorie_goal = ai.daily_calorie_goal;
      form.value.daily_protein_goal_g = ai.daily_protein_goal_g;
      form.value.daily_carbs_goal_g = ai.daily_carbs_goal_g;
      form.value.daily_fat_goal_g = ai.daily_fat_goal_g;
      aiNote.value = ai.summary;
    } else {
      aiNote.value = 'AI is unavailable right now — using the calculated targets.';
    }
  } finally {
    aiBusy.value = false;
  }
}

const form = ref({
  start_weight_kg: 70.7,
  start_date: todayISO(),
  goal_weight_kg: 68,
  target_date: '',
  tolerance_kg: 0.3,
  daily_step_goal: 15000 as number | null,
  weekly_training_days: 6 as number | null,
  daily_calorie_goal: 1900 as number | null,
  daily_protein_goal_g: 150 as number | null,
  daily_carbs_goal_g: 190 as number | null,
  daily_fat_goal_g: 63 as number | null,
});

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const response = await fetch('/api/goals', { credentials: 'same-origin' });
    if (response.status === 401) {
      window.location.href = '/app/login';
      return;
    }
    if (!response.ok) throw new Error('failed');
    const payload = (await response.json()) as GoalsPayload;
    data.value = payload;

    if (payload.plan) {
      form.value = {
        ...form.value,
        ...payload.plan,
        daily_calorie_goal: payload.macros.calories,
        daily_protein_goal_g: payload.macros.protein_g,
        daily_carbs_goal_g: payload.macros.carbs_g,
        daily_fat_goal_g: payload.macros.fat_g,
      };
    } else {
      // No plan yet — drop straight into the smart editor.
      form.value.start_date = todayISO();
      form.value.target_date = addDays(todayISO(), 56);
      await openEditor();
    }
  } catch {
    error.value = "Couldn't load your goals.";
  } finally {
    loading.value = false;
  }
}

const planValid = computed(
  () =>
    form.value.target_date > form.value.start_date &&
    form.value.start_weight_kg > 0 &&
    form.value.goal_weight_kg > 0
);

/** Weekly rate the plan implies — the honesty check on an ambitious date. */
const impliedRate = computed(() => {
  if (!planValid.value) return null;
  const [y1, m1, d1] = form.value.start_date.split('-').map(Number);
  const [y2, m2, d2] = form.value.target_date.split('-').map(Number);
  const days =
    (Date.UTC(y2!, m2! - 1, d2!) - Date.UTC(y1!, m1! - 1, d1!)) / 86_400_000;
  if (days <= 0) return null;
  return ((form.value.goal_weight_kg - form.value.start_weight_kg) / days) * 7;
});

const rateWarning = computed(() => {
  const rate = impliedRate.value;
  if (rate === null) return null;
  const perWeek = Math.abs(rate);
  if (perWeek > 1.0) {
    return `That's ${perWeek.toFixed(2)} kg/week. Above roughly 1 kg you start losing muscle alongside fat — consider a later date.`;
  }
  if (perWeek < 0.15 && perWeek > 0) {
    return `That's only ${perWeek.toFixed(2)} kg/week, slow enough that normal weight fluctuation will hide it.`;
  }
  return null;
});

async function save(): Promise<void> {
  if (!planValid.value) return;
  saving.value = true;
  try {
    const response = await fetch('/api/goals', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form.value),
    });
    if (!response.ok) throw new Error('failed');
    editing.value = false;
    await load();
  } catch {
    error.value = "Couldn't save. Check your connection.";
  } finally {
    saving.value = false;
  }
}

const current = computed(() => {
  const logged = data.value?.glide_path.filter((w) => w.actual_kg !== null) ?? [];
  return logged.length ? logged[logged.length - 1]! : null;
});

const remaining = computed(() => {
  const plan = data.value?.plan;
  const latest = data.value?.latest_weight;
  if (!plan || latest === null || latest === undefined) return null;
  return Math.max(0, Math.abs(latest - plan.goal_weight_kg));
});

const STATUS_LABEL: Record<GlideWeek['status'], string> = {
  ahead: 'AHEAD',
  on: 'ON PACE',
  watch: 'WATCH',
  behind: 'BEHIND',
  empty: '—',
};

/** Average daily steps over the last 7 days that actually have step data.
 *  A recent window is what "how active am I lately" means — averaging 60 days
 *  buries a good (or bad) week in old data. Days with no steps are excluded
 *  rather than counted as zero (we can't tell "didn't walk" from "no data"). */
const stepAverage = computed(() => {
  const cutoff = addDays(todayISO(), -6);
  const recent = (data.value?.activity ?? []).filter(
    (a) => a.steps !== null && a.activity_date >= cutoff
  );
  if (recent.length === 0) return null;
  return Math.round(recent.reduce((sum, a) => sum + (a.steps ?? 0), 0) / recent.length);
});

const recentDeficit = computed(() => {
  const weeks = data.value?.weekly_deficit ?? [];
  return weeks.length ? weeks[weeks.length - 1]! : null;
});

// ── Manual weight + steps entry ───────────────────────────
const logWeight = ref<number | null>(null);
const logSteps = ref<number | null>(null);
const logBusy = ref(false);
const logMsg = ref<string | null>(null);

async function saveLog(): Promise<void> {
  if (logWeight.value == null && logSteps.value == null) return;
  logBusy.value = true;
  logMsg.value = null;
  try {
    await api.logActivity({
      activity_date: todayISO(),
      weight_kg: logWeight.value ?? null,
      steps: logSteps.value ?? null,
    });
    logMsg.value = 'Saved for today.';
    logWeight.value = null;
    logSteps.value = null;
    await load(); // refresh weigh-in chart + steps average
  } catch {
    logMsg.value = "Couldn't save. Check your connection.";
  } finally {
    logBusy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="page">
    <p class="eyebrow">Plan</p>

    <div v-if="loading" class="card">
      <div class="skeleton" style="height: 16px; width: 45%; margin-bottom: 14px"></div>
      <div class="skeleton" style="height: 140px"></div>
    </div>

    <div v-else-if="error" class="card">
      <p style="margin: 0 0 12px">{{ error }}</p>
      <button class="btn btn-ghost" @click="load">Try again</button>
    </div>

    <template v-else-if="data">
      <template v-if="!editing && data.plan">
        <h1>
          Descent to <span class="accentnum mono">{{ data.plan.goal_weight_kg.toFixed(1) }}</span>
        </h1>
        <p class="sub">
          {{ data.plan.start_weight_kg.toFixed(1) }} kg on {{ data.plan.start_date }} →
          {{ data.plan.goal_weight_kg.toFixed(1) }} kg by {{ data.plan.target_date }}
        </p>

        <div class="readouts">
          <div class="ro">
            <div class="k">Current</div>
            <div class="v mono">
              {{ data.latest_weight?.toFixed(1) ?? '—' }}<small> kg</small>
            </div>
          </div>
          <div class="ro">
            <div class="k">Remaining</div>
            <div class="v mono cyan">
              {{ remaining?.toFixed(1) ?? '—' }}<small> kg</small>
            </div>
          </div>
          <div class="ro">
            <div class="k">Pace</div>
            <div class="v mono" :class="current?.status">
              {{ current ? STATUS_LABEL[current.status] : '—' }}
            </div>
          </div>
          <div class="ro">
            <div class="k">Steps avg</div>
            <div class="v mono">{{ stepAverage?.toLocaleString() ?? '—' }}</div>
          </div>
        </div>

        <!-- Manual daily log: weight + steps -->
        <div class="logcard card">
          <div class="log-fields">
            <label class="lf">
              <span>Today's weight (kg)</span>
              <input v-model.number="logWeight" type="number" step="0.1" inputmode="decimal" placeholder="—" />
            </label>
            <label class="lf">
              <span>Today's steps</span>
              <input v-model.number="logSteps" type="number" inputmode="numeric" placeholder="—" />
            </label>
          </div>
          <button
            class="btn wide"
            :disabled="logBusy || (logWeight == null && logSteps == null)"
            @click="saveLog"
          >
            {{ logBusy ? 'Saving…' : 'Log for today' }}
          </button>
          <p v-if="logMsg" class="log-msg">{{ logMsg }}</p>
        </div>

        <GlideChart
          v-if="data.glide_path.length"
          :weeks="data.glide_path"
          :goal="data.plan.goal_weight_kg"
          :tolerance="data.plan.tolerance_kg"
        />

        <h2>Daily targets</h2>
        <div class="targets">
          <div class="tcard cal">
            <div class="lab">Calories</div>
            <div class="big mono">{{ data.macros.calories ?? '—' }}</div>
          </div>
          <div class="tcard pro">
            <div class="lab">Protein</div>
            <div class="big mono">{{ data.macros.protein_g ?? '—' }}<u>g</u></div>
          </div>
          <div class="tcard step">
            <div class="lab">Steps</div>
            <div class="big mono">{{ data.plan.daily_step_goal?.toLocaleString() ?? '—' }}</div>
          </div>
          <div class="tcard train">
            <div class="lab">Training</div>
            <div class="big mono">{{ data.plan.weekly_training_days ?? '—' }}<u>/wk</u></div>
          </div>
        </div>

        <h2>Weekly deficit</h2>
        <div v-if="data.weekly_deficit.length === 0" class="card">
          <p class="muted" style="margin: 0; font-size: 14px">
            Needs at least four logged days in a week, plus a recorded TDEE from a weigh-in.
            Log consistently for a week and this fills in.
          </p>
        </div>
        <div v-else class="card">
          <div v-for="week in data.weekly_deficit.slice(-6)" :key="week.week_start" class="wrow">
            <span class="mono muted wdate">{{ week.week_start }}</span>
            <span class="mono wval">{{ week.total_deficit.toLocaleString() }} kcal</span>
            <span class="mono muted wproj">≈ {{ week.projected_kg.toFixed(2) }} kg</span>
            <span class="muted wdays">{{ week.days_logged }}d</span>
          </div>
          <p v-if="recentDeficit" class="muted footnote">
            Projection uses 7700 kcal per kg. Expenditure comes from your recorded TDEE — Apple
            Health active energy is deliberately not added on top, since TDEE already assumes
            your usual movement.
          </p>
        </div>

        <button class="btn btn-ghost wide" @click="openEditor">Edit plan</button>
      </template>

      <template v-else>
        <h1>{{ data.plan ? 'Edit plan' : 'Set your plan' }}</h1>
        <p class="sub">Pick a goal and pace — I'll recalculate your targets, just like setup.</p>

        <!-- Smart editor (needs profile stats to auto-calculate) -->
        <template v-if="canCompute">
          <div class="card form">
            <!-- current weight + activity feed the maintenance calc -->
            <div class="grid2">
              <div class="field">
                <label>Current weight (kg)</label>
                <input v-model.number="editWeight" type="number" step="0.1" inputmode="decimal" />
              </div>
              <div class="field">
                <label>Activity</label>
                <select v-model="editActivity">
                  <option v-for="(a, key) in ACTIVITY" :key="key" :value="key">{{ a.label }}</option>
                </select>
              </div>
            </div>
            <p class="maint-line mono">
              Maintenance ≈ {{ editTdee?.toLocaleString() }} kcal/day
            </p>

            <h2 class="formh">Goal</h2>
            <div class="goalrow">
              <button
                v-for="(g, key) in GOALS"
                :key="key"
                type="button"
                class="goalpill"
                :class="{ active: editGoal === key }"
                @click="pickEditGoal(key as Goal)"
              >
                {{ g.label }}
              </button>
            </div>

            <template v-if="editRateOptions.length">
              <h2 class="formh">
                Pace <span class="mono deltahint">≈ {{ editDelta }} kcal/day {{ editGoal === 'cut' ? 'deficit' : 'surplus' }}</span>
              </h2>
              <div class="raterow">
                <button
                  v-for="r in editRateOptions"
                  :key="r.kg"
                  type="button"
                  class="ratepill"
                  :class="{ active: editRate === r.kg }"
                  @click="editRate = r.kg"
                >
                  <span>{{ r.label }}</span>
                  <span class="ratetag">{{ r.tag }}</span>
                </button>
              </div>

              <div class="field" style="margin-top: 14px">
                <label>Goal weight (kg) — optional</label>
                <input v-model.number="editTargetWeight" type="number" step="0.1" inputmode="decimal" :placeholder="editGoal === 'cut' ? 'e.g. 68' : 'e.g. 78'" />
              </div>
            </template>

            <!-- computed targets preview -->
            <h2 class="formh">Your daily targets</h2>
            <div class="targets">
              <div class="tcard cal"><div class="lab">Calories</div><div class="big mono">{{ form.daily_calorie_goal }}</div></div>
              <div class="tcard pro"><div class="lab">Protein</div><div class="big mono">{{ form.daily_protein_goal_g }}<u>g</u></div></div>
              <div class="tcard step"><div class="lab">Carbs</div><div class="big mono">{{ form.daily_carbs_goal_g }}<u>g</u></div></div>
              <div class="tcard train"><div class="lab">Fat</div><div class="big mono">{{ form.daily_fat_goal_g }}<u>g</u></div></div>
            </div>

            <button class="btn btn-ghost wide ai-btn" :disabled="aiBusy" @click="refineWithAI">
              {{ aiBusy ? 'Thinking…' : '✨ Refine with AI coach' }}
            </button>
            <div v-if="aiNote" class="ainote">
              <span class="ainote-h">🥗 Coach</span><p>{{ aiNote }}</p>
            </div>

            <!-- advanced: fine-tune raw numbers -->
            <button class="advanced-toggle" @click="showAdvanced = !showAdvanced">
              {{ showAdvanced ? '▾ Hide' : '▸ Fine-tune numbers & steps' }}
            </button>
            <div v-if="showAdvanced" class="grid2 adv">
              <div class="field"><label>Calories</label><input v-model.number="form.daily_calorie_goal" type="number" /></div>
              <div class="field"><label>Protein (g)</label><input v-model.number="form.daily_protein_goal_g" type="number" /></div>
              <div class="field"><label>Carbs (g)</label><input v-model.number="form.daily_carbs_goal_g" type="number" /></div>
              <div class="field"><label>Fat (g)</label><input v-model.number="form.daily_fat_goal_g" type="number" /></div>
              <div class="field"><label>Daily steps</label><input v-model.number="form.daily_step_goal" type="number" /></div>
              <div class="field"><label>Training days/wk</label><input v-model.number="form.weekly_training_days" type="number" min="0" max="7" /></div>
            </div>

            <div class="row" style="margin-top: 18px">
              <button v-if="data.plan" class="btn btn-ghost" style="flex: 1" @click="editing = false">Cancel</button>
              <button class="btn" style="flex: 2" :disabled="!planValid || saving" @click="save">
                {{ saving ? 'Saving…' : 'Save plan' }}
              </button>
            </div>
          </div>
        </template>

        <!-- Fallback: no profile stats yet → manual entry -->
        <template v-else>
          <div class="card notice-mini">
            Add your height, age and sex in <strong>You → Goals</strong> (during setup) to auto-calculate
            targets. For now, enter them manually:
          </div>
          <div class="card form">
            <div class="grid2">
              <div class="field"><label>Start weight (kg)</label><input v-model.number="form.start_weight_kg" type="number" step="0.1" /></div>
              <div class="field"><label>Goal weight (kg)</label><input v-model.number="form.goal_weight_kg" type="number" step="0.1" /></div>
              <div class="field"><label>Start date</label><input v-model="form.start_date" type="date" /></div>
              <div class="field"><label>Target date</label><input v-model="form.target_date" type="date" /></div>
            </div>
            <p v-if="rateWarning" class="warn-note">{{ rateWarning }}</p>
            <p v-else-if="impliedRate !== null" class="muted rate">Implied pace: {{ Math.abs(impliedRate).toFixed(2) }} kg/week</p>
            <h2 class="formh">Daily targets</h2>
            <div class="grid2">
              <div class="field"><label>Calories</label><input v-model.number="form.daily_calorie_goal" type="number" /></div>
              <div class="field"><label>Protein (g)</label><input v-model.number="form.daily_protein_goal_g" type="number" /></div>
              <div class="field"><label>Carbs (g)</label><input v-model.number="form.daily_carbs_goal_g" type="number" /></div>
              <div class="field"><label>Fat (g)</label><input v-model.number="form.daily_fat_goal_g" type="number" /></div>
              <div class="field"><label>Daily steps</label><input v-model.number="form.daily_step_goal" type="number" /></div>
              <div class="field"><label>Training days/wk</label><input v-model.number="form.weekly_training_days" type="number" min="0" max="7" /></div>
            </div>
            <div class="row" style="margin-top: 16px">
              <button v-if="data.plan" class="btn btn-ghost" style="flex: 1" @click="editing = false">Cancel</button>
              <button class="btn" style="flex: 2" :disabled="!planValid || saving" @click="save">
                {{ saving ? 'Saving…' : 'Save plan' }}
              </button>
            </div>
          </div>
        </template>
      </template>

    </template>
  </div>
</template>

<style scoped>
.eyebrow {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--accent);
  margin: 0 0 10px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.eyebrow::after {
  content: '';
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, var(--border), transparent);
}

h1 {
  font-size: clamp(28px, 8vw, 40px);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1;
  margin: 0;
}

.accentnum {
  color: var(--accent);
}

.sub {
  color: var(--text-dim);
  font-size: 14px;
  margin: 10px 0 0;
}

.logcard {
  margin: 4px 0 16px;
  padding: 14px;
}

.log-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 12px;
}

.lf {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--text-dim);
}

.log-msg {
  font-size: 13px;
  color: var(--accent);
  margin: 10px 0 0;
  text-align: center;
}

.readouts {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1px;
  background: var(--border);
  border: 1px solid var(--border);
  border-radius: 14px;
  overflow: hidden;
  margin: 20px 0;
}

.ro {
  background: var(--surface);
  padding: 14px 16px;
}

.ro .k {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-dim);
}

.ro .v {
  font-size: 21px;
  font-weight: 700;
  margin-top: 5px;
}

.ro .v small {
  font-size: 12px;
  color: var(--text-dim);
  font-weight: 400;
}

.cyan {
  color: #5ad1ff;
}

.v.ahead {
  color: #5ad1ff;
}
.v.on {
  color: var(--accent);
}
.v.watch {
  color: var(--warn);
}
.v.behind {
  color: var(--danger);
}

.targets {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.tcard {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px 15px;
  position: relative;
  overflow: hidden;
}

.tcard::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--stripe, var(--accent));
}

.tcard.cal {
  --stripe: #5ad1ff;
}
.tcard.pro {
  --stripe: var(--accent);
}
.tcard.step {
  --stripe: var(--warn);
}
.tcard.train {
  --stripe: #a98bff;
}

.tcard .lab {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-dim);
}

.tcard .big {
  font-size: 24px;
  font-weight: 700;
  margin-top: 6px;
}

.tcard .big u {
  font-size: 12px;
  text-decoration: none;
  color: var(--text-dim);
  font-weight: 400;
}

.wrow {
  display: grid;
  grid-template-columns: 1fr auto auto auto;
  gap: 10px;
  align-items: baseline;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}

.wrow:last-of-type {
  border-bottom: none;
}

.wdate {
  font-size: 12px;
}

.wval {
  font-weight: 600;
}

.wproj,
.wdays {
  font-size: 12px;
}

.footnote {
  font-size: 12px;
  margin: 12px 0 0;
}

.form .field {
  margin-bottom: 12px;
}

.form label {
  display: block;
  font-size: 12px;
  color: var(--text-dim);
  margin-bottom: 5px;
}

.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 12px;
}

.formh {
  margin-top: 18px;
}

.warn-note {
  color: var(--warn);
  font-size: 13px;
  background: rgba(251, 191, 36, 0.1);
  border-radius: 10px;
  padding: 10px 12px;
  margin: 4px 0 0;
}

.rate {
  font-family: var(--mono);
  font-size: 12.5px;
  margin: 4px 0 0;
}

.wide {
  width: 100%;
  margin-top: 16px;
}

/* ── Smart editor ─────────────────────────────────────────── */
.maint-line {
  font-size: 13px;
  color: var(--accent);
  margin: 4px 0 0;
}

.deltahint {
  font-size: 11px;
  color: var(--accent);
  text-transform: none;
  letter-spacing: 0;
  font-weight: 400;
}

.goalrow {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.goalpill {
  padding: 11px 6px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 12px;
  color: var(--text);
  font-size: 14px;
}

.goalpill.active {
  border-color: var(--accent);
  color: var(--accent);
  background: rgba(74, 222, 128, 0.08);
}

.raterow {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.ratepill {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 4px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 12px;
  color: var(--text);
  font-size: 13px;
}

.ratepill.active {
  border-color: var(--accent);
  background: rgba(74, 222, 128, 0.08);
}

.ratetag {
  font-size: 10px;
  color: var(--text-dim);
}

.ai-btn {
  color: var(--accent);
}

.ainote {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px 14px;
  margin-top: 12px;
}

.ainote-h {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
}

.ainote p {
  margin: 6px 0 0;
  font-size: 13.5px;
  line-height: 1.5;
}

.advanced-toggle {
  width: 100%;
  text-align: left;
  font-size: 13px;
  color: var(--text-dim);
  padding: 12px 2px;
  min-height: auto;
}

.adv {
  margin-top: 4px;
}

.notice-mini {
  font-size: 13px;
  line-height: 1.5;
  padding: 12px 14px;
  margin-bottom: 12px;
}
</style>
