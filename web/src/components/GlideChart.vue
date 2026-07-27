<script setup lang="ts">
import { computed } from 'vue';

interface GlideWeek {
  week: number;
  date: string;
  target_kg: number;
  actual_kg: number | null;
  status: 'ahead' | 'on' | 'watch' | 'behind' | 'empty';
}

const props = defineProps<{
  weeks: GlideWeek[];
  goal: number;
  tolerance: number;
}>();

// viewBox sized close to a phone's width so text/strokes render near 1:1 and
// stay legible (a wide viewBox scaled down to 340px shrinks all text with it).
const W = 360;
const H = 300;
const PAD = { l: 30, r: 16, t: 16, b: 34 };

const STATUS_COLOR: Record<GlideWeek['status'], string> = {
  ahead: '#5ad1ff',
  on: '#4ade80',
  watch: '#fbbf24',
  behind: '#f87171',
  empty: '#5d6a80',
};

/** Y bounds cover the plan plus every actual reading, with a little headroom. */
const bounds = computed(() => {
  const values = [
    ...props.weeks.map((w) => w.target_kg),
    ...props.weeks.flatMap((w) => (w.actual_kg === null ? [] : [w.actual_kg])),
  ];
  const min = Math.min(...values) - 0.4;
  const max = Math.max(...values) + 0.4;
  return { min, max };
});

const lastWeek = computed(() => Math.max(1, props.weeks.length - 1));

function x(week: number): number {
  return PAD.l + (week / lastWeek.value) * (W - PAD.l - PAD.r);
}

function y(kg: number): number {
  const { min, max } = bounds.value;
  const span = max - min || 1;
  return PAD.t + ((max - kg) / span) * (H - PAD.t - PAD.b);
}

/** Gridlines at a step that keeps them ~5–6 apart, so they don't crowd. */
const gridStep = computed(() => ((bounds.value.max - bounds.value.min) > 4 ? 1 : 0.5));

const gridLines = computed(() => {
  const { min, max } = bounds.value;
  const step = gridStep.value;
  const lines: number[] = [];
  for (let kg = Math.ceil(min / step) * step; kg <= max; kg += step) {
    lines.push(Math.round(kg * 10) / 10);
  }
  return lines;
});

const bandPath = computed(() => {
  const upper = props.weeks.map((w) => `${x(w.week)},${y(w.target_kg + props.tolerance)}`);
  const lower = [...props.weeks]
    .reverse()
    .map((w) => `${x(w.week)},${y(w.target_kg - props.tolerance)}`);
  return `M${upper.join(' L')} L${lower.join(' L')} Z`;
});

const glidePath = computed(() =>
  props.weeks.map((w, i) => `${i ? 'L' : 'M'}${x(w.week)} ${y(w.target_kg)}`).join(' ')
);

const logged = computed(() => props.weeks.filter((w) => w.actual_kg !== null));

const actualPath = computed(() =>
  logged.value.map((w, i) => `${i ? 'L' : 'M'}${x(w.week)} ${y(w.actual_kg!)}`).join(' ')
);

/** Thin x-axis labels to ~6 across, whatever the plan length. */
const labelStep = computed(() => Math.max(1, Math.ceil(props.weeks.length / 6)));

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[(m ?? 1) - 1]} ${d}`;
}
</script>

<template>
  <div class="chartcard">
    <svg :viewBox="`0 0 ${W} ${H}`" role="img" aria-label="Weight glide path">
      <line
        v-for="kg in gridLines"
        :key="kg"
        class="grid"
        :x1="PAD.l"
        :x2="W - PAD.r"
        :y1="y(kg)"
        :y2="y(kg)"
      />
      <text
        v-for="kg in gridLines"
        :key="`t${kg}`"
        class="axis"
        :x="PAD.l - 10"
        :y="y(kg) + 4"
        text-anchor="end"
      >
        {{ kg.toFixed(1) }}
      </text>

      <path :d="bandPath" class="band" />

      <line class="goal" :x1="PAD.l" :x2="W - PAD.r" :y1="y(goal)" :y2="y(goal)" />
      <text class="axis goal-lab" :x="W - PAD.r" :y="y(goal) - 8" text-anchor="end">
        {{ goal.toFixed(1) }} goal
      </text>

      <path :d="glidePath" class="glide" />

      <g v-for="week in weeks" :key="week.week">
        <circle class="tdot" :cx="x(week.week)" :cy="y(week.target_kg)" r="2.6" />
        <text
          v-if="week.week % labelStep === 0"
          class="axis"
          :x="x(week.week)"
          :y="H - PAD.b + 20"
          text-anchor="middle"
        >
          {{ shortDate(week.date) }}
        </text>
      </g>

      <path v-if="logged.length > 1" :d="actualPath" class="actual" />

      <g v-for="week in logged" :key="`a${week.week}`">
        <circle
          :cx="x(week.week)"
          :cy="y(week.actual_kg!)"
          r="5"
          :stroke="STATUS_COLOR[week.status]"
          fill="var(--bg)"
          stroke-width="2.2"
        />
        <circle
          :cx="x(week.week)"
          :cy="y(week.actual_kg!)"
          r="2"
          :fill="STATUS_COLOR[week.status]"
        />
      </g>
    </svg>

    <div class="legend mono">
      <span><i class="dash"></i> plan</span>
      <span><i class="swatch band-sw"></i> ±{{ tolerance }} kg</span>
      <span><i class="swatch" style="background: var(--text)"></i> actual</span>
    </div>

    <p v-if="logged.length === 0" class="muted empty">
      No weigh-ins matched to plan weeks yet. Record one within three days of a week marker and
      it appears here.
    </p>
  </div>
</template>

<style scoped>
.chartcard {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 18px 14px 10px;
  margin: 6px 0 8px;
}

svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}

.grid {
  stroke: var(--border);
  stroke-width: 1;
  opacity: 0.6;
}

.axis {
  fill: var(--text-dim);
  font-family: var(--mono);
  font-size: 12px;
}

.band {
  fill: rgba(74, 222, 128, 0.1);
}

.goal {
  stroke: #5ad1ff;
  stroke-width: 1;
  stroke-dasharray: 2 3;
  opacity: 0.5;
}

.goal-lab {
  fill: #5ad1ff;
}

.glide {
  fill: none;
  stroke: var(--accent);
  stroke-width: 2;
  stroke-dasharray: 5 4;
  opacity: 0.55;
}

.tdot {
  fill: var(--bg);
  stroke: var(--accent);
  stroke-width: 1.5;
}

.actual {
  fill: none;
  stroke: var(--text);
  stroke-width: 2.5;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.legend {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  padding: 8px 4px 4px;
  font-size: 11px;
  color: var(--text-dim);
}

.legend span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.swatch {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  display: inline-block;
}

.band-sw {
  background: rgba(74, 222, 128, 0.35);
  border-radius: 2px;
}

.dash {
  width: 16px;
  height: 0;
  border-top: 2px dashed var(--accent);
  opacity: 0.7;
  display: inline-block;
}

.empty {
  font-size: 13px;
  margin: 6px 4px 8px;
}
</style>
