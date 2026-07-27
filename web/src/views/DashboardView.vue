<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { toLocalISODate } from '../dates';
import ShareStory from '../components/ShareStory.vue';

interface DailyTotal {
  entry_date: string;
  calories: number;
  protein_g: number;
  entry_count: number;
}

interface WeeklyStats {
  daily: DailyTotal[];
  streak: number;
  days_logged: number;
  complete_days: number;
  average_calories: number;
  complete_day_threshold: number;
}

const GOAL_CALORIES = 1900;

const stats = ref<WeeklyStats | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

// ── AI weekly report ──────────────────────────────────────
interface WeeklyReport {
  report: { headline: string; summary: string; wins: string[]; focus: string[] };
  generated_at: string;
  source: 'ai' | 'rule' | 'insufficient';
}
const report = ref<WeeklyReport | null>(null);
const reportLoading = ref(true);
const reportRefreshing = ref(false);
const showShareWeek = ref(false);

async function loadReport(refresh = false): Promise<void> {
  if (refresh) reportRefreshing.value = true;
  else reportLoading.value = true;
  try {
    const res = await fetch(`/api/insights/weekly${refresh ? '?refresh=1' : ''}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (res.ok) report.value = (await res.json()) as WeeklyReport;
  } catch {
    /* leave prior report; the tab still shows charts */
  } finally {
    reportLoading.value = false;
    reportRefreshing.value = false;
  }
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const response = await fetch('/api/stats/weekly?days=30', {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (response.status === 401) {
      window.location.href = '/app/login';
      return;
    }
    if (!response.ok) throw new Error('failed');
    stats.value = (await response.json()) as WeeklyStats;
  } catch {
    error.value = "Couldn't load your trends.";
  } finally {
    loading.value = false;
  }
}

/**
 * Last 14 calendar days, including days with nothing logged.
 *
 * The API omits empty days (it can't tell "ate nothing" from "didn't log"),
 * but the chart must not: this is a consistency view, and collapsing the gaps
 * would render 12 logged days as an unbroken fortnight.
 */
const bars = computed(() => {
  if (!stats.value) return [];

  const byDate = new Map(stats.value.daily.map((day) => [day.entry_date, day]));
  const peak = Math.max(GOAL_CALORIES, ...stats.value.daily.map((d) => d.calories));
  const days: Array<{
    date: string;
    calories: number;
    heightPct: number;
    over: boolean;
    missing: boolean;
    label: string;
  }> = [];

  for (let offset = 13; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    const key = toLocalISODate(date);
    const logged = byDate.get(key);

    days.push({
      date: key,
      calories: logged?.calories ?? 0,
      heightPct: logged ? (logged.calories / peak) * 100 : 0,
      over: (logged?.calories ?? 0) > GOAL_CALORIES,
      missing: !logged,
      label: date.toLocaleDateString(undefined, { weekday: 'narrow' }),
    });
  }

  return days;
});

const goalLinePct = computed(() => {
  if (!stats.value) return 0;
  const peak = Math.max(GOAL_CALORIES, ...stats.value.daily.map((d) => d.calories));
  return (GOAL_CALORIES / peak) * 100;
});

const missedDays = computed(() => bars.value.filter((bar) => bar.missing).length);

onMounted(() => {
  load();
  loadReport();
});
</script>

<template>
  <div class="page">
    <h1>Trends</h1>

    <!-- AI weekly report -->
    <div class="report card">
      <div class="report-head">
        <span class="report-eyebrow">🥗 Weekly report</span>
        <button
          class="report-refresh"
          :disabled="reportRefreshing || reportLoading"
          @click="loadReport(true)"
        >
          {{ reportRefreshing ? '…' : '↻ Refresh' }}
        </button>
      </div>

      <div v-if="reportLoading" class="report-loading">
        <div class="skeleton" style="height: 18px; width: 70%; margin-bottom: 10px"></div>
        <div class="skeleton" style="height: 12px; width: 100%; margin-bottom: 6px"></div>
        <div class="skeleton" style="height: 12px; width: 85%"></div>
      </div>

      <template v-else-if="report">
        <h2 class="report-headline">{{ report.report.headline }}</h2>
        <p class="report-summary">{{ report.report.summary }}</p>

        <div v-if="report.report.wins.length" class="report-list wins">
          <div class="report-list-title">What went well</div>
          <div v-for="(w, i) in report.report.wins" :key="'w' + i" class="report-item">
            <span class="dot ok"></span><span>{{ w }}</span>
          </div>
        </div>

        <div v-if="report.report.focus.length" class="report-list focus">
          <div class="report-list-title">Focus next week</div>
          <div v-for="(f, i) in report.report.focus" :key="'f' + i" class="report-item">
            <span class="dot warn"></span><span>{{ f }}</span>
          </div>
        </div>

        <p v-if="report.source === 'rule'" class="report-note muted">
          Based on your numbers (AI coach unavailable right now).
        </p>

        <button v-if="report.source !== 'insufficient'" class="share-week" @click="showShareWeek = true">
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
            <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13"
              fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          Share this week
        </button>
      </template>
    </div>

    <ShareStory v-if="showShareWeek" type="week" date="" @close="showShareWeek = false" />

    <div v-if="loading" class="card" style="margin-top: 16px">
      <div class="skeleton" style="height: 14px; width: 40%; margin-bottom: 16px"></div>
      <div class="skeleton" style="height: 120px"></div>
    </div>

    <div v-else-if="error" class="card" style="margin-top: 16px">
      <p style="margin: 0 0 12px">{{ error }}</p>
      <button class="btn btn-ghost" @click="load">Try again</button>
    </div>

    <template v-else-if="stats">
      <div class="stats">
        <div class="card stat">
          <div class="stat-value">{{ stats.streak }}</div>
          <div class="muted stat-label">day streak</div>
        </div>
        <div class="card stat">
          <div class="stat-value">{{ stats.average_calories }}</div>
          <div class="muted stat-label">avg kcal</div>
        </div>
        <div class="card stat">
          <div class="stat-value">{{ stats.complete_days }}<span class="of">/30</span></div>
          <div class="muted stat-label">days logged</div>
        </div>
      </div>

      <h2>Last 14 days</h2>

      <div v-if="bars.length === 0" class="card">
        <p class="muted" style="margin: 0">
          No entries in the last 30 days. Log something today and your trend starts here.
        </p>
      </div>

      <div v-else class="card chart-card">
        <div class="chart">
          <div class="goal-line" :style="{ bottom: `${goalLinePct}%` }">
            <span class="goal-label">{{ GOAL_CALORIES }}</span>
          </div>
          <div v-for="bar in bars" :key="bar.date" class="bar-col">
            <div
              v-if="bar.missing"
              class="bar missing"
              :title="`${bar.date}: nothing logged`"
            ></div>
            <div
              v-else
              class="bar"
              :class="{ over: bar.over }"
              :style="{ height: `${bar.heightPct}%` }"
              :title="`${bar.date}: ${bar.calories} kcal`"
            ></div>
            <span class="bar-label">{{ bar.label }}</span>
          </div>
        </div>
      </div>

      <p class="muted footnote">
        <template v-if="missedDays > 0">
          {{ missedDays }} of the last 14 days have nothing logged (shown as gaps).
        </template>
        A day counts toward the streak once it passes
        {{ stats.complete_day_threshold }} kcal, so a half-finished log doesn't count as a
        full day.
      </p>
    </template>
  </div>
</template>

<style scoped>
.report {
  margin-top: 16px;
  padding: 16px;
}

.report-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.report-eyebrow {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--accent);
}

.report-refresh {
  font-size: 12px;
  color: var(--text-dim);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 5px 10px;
  min-height: 30px;
}

.report-headline {
  font-size: 18px;
  font-weight: 700;
  color: var(--text);
  text-transform: none;
  letter-spacing: normal;
  margin: 0 0 8px;
}

.report-summary {
  font-size: 14px;
  line-height: 1.55;
  color: var(--text);
  margin: 0 0 4px;
}

.report-list {
  margin-top: 14px;
}

.report-list-title {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-dim);
  margin-bottom: 6px;
}

.report-item {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  font-size: 13.5px;
  line-height: 1.45;
  padding: 3px 0;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-top: 6px;
  flex-shrink: 0;
}

.dot.ok {
  background: var(--accent);
}

.dot.warn {
  background: var(--warn);
}

.report-note {
  font-size: 11px;
  margin: 12px 0 0;
}

.stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-top: 16px;
}

.stat {
  text-align: center;
  padding: 14px 8px;
}

.stat-value {
  font-size: 24px;
  font-weight: 700;
}

.of {
  font-size: 14px;
  color: var(--text-dim);
  font-weight: 500;
}

.stat-label {
  font-size: 12px;
}

.chart-card {
  padding-top: 22px;
}

.chart {
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: 5px;
  height: 150px;
}

.bar-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  height: 100%;
}

.bar {
  width: 100%;
  background: var(--accent);
  border-radius: 4px 4px 0 0;
  min-height: 3px;
  transition: height 0.3s ease;
}

.bar.over {
  background: var(--warn);
}

/* A missed day is drawn as a faint full-height slot rather than omitted, so
   gaps in consistency are visible at a glance. */
.bar.missing {
  height: 100%;
  background: repeating-linear-gradient(
    45deg,
    var(--surface-2),
    var(--surface-2) 3px,
    transparent 3px,
    transparent 6px
  );
  border-radius: 4px;
}

.bar-label {
  font-size: 10px;
  color: var(--text-dim);
  margin-top: 6px;
}

.goal-line {
  position: absolute;
  left: 0;
  right: 0;
  border-top: 1px dashed var(--text-dim);
  opacity: 0.5;
  pointer-events: none;
}

.goal-label {
  position: absolute;
  right: 0;
  top: -16px;
  font-size: 10px;
  color: var(--text-dim);
}

.footnote {
  font-size: 12.5px;
  margin-top: 14px;
}
</style>
