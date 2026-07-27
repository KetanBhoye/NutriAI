<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

interface UserRow {
  name: string;
  email: string;
  role: string;
  signed_up: string;
  entries: number;
  days_logged: number;
  last_log: string | null;
  active_7d: boolean;
}
interface Overview {
  users: { total: number; logged_food: number; active_7d: number; list: UserRow[] };
  content: { total_entries: number; entries_7d: number; foods: number; weigh_ins: number };
  ai: {
    input_tokens: number;
    output_tokens: number;
    invocations: number;
    cost_usd: number;
    days: number;
    input_rate_per_m: number;
    output_rate_per_m: number;
  } | null;
  railway_estimate_usd: number;
  generated_at: string;
}

const data = ref<Overview | null>(null);
const loading = ref(true);
const forbidden = ref(false);
const error = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await fetch('/api/admin/overview', { credentials: 'same-origin', cache: 'no-store' });
    if (res.status === 401) {
      window.location.href = '/app/login';
      return;
    }
    if (res.status === 403) {
      forbidden.value = true;
      return;
    }
    if (!res.ok) throw new Error('failed');
    data.value = (await res.json()) as Overview;
  } catch {
    error.value = "Couldn't load the dashboard.";
  } finally {
    loading.value = false;
  }
}

const activationPct = computed(() => {
  const u = data.value?.users;
  return u && u.total ? Math.round((u.logged_food / u.total) * 100) : 0;
});

const perAction = computed(() => {
  const ai = data.value?.ai;
  return ai && ai.invocations ? ai.cost_usd / ai.invocations : 0;
});

const totalMonthly = computed(() => {
  const d = data.value;
  return d ? (d.ai?.cost_usd ?? 0) + d.railway_estimate_usd : 0;
});

function fmt(n: number): string {
  return n.toLocaleString();
}

onMounted(load);
</script>

<template>
  <div class="admin">
    <div class="head">
      <div>
        <p class="eyebrow">Admin</p>
        <h1>NutriAI dashboard</h1>
      </div>
      <button class="refresh" :disabled="loading" @click="load">↻ Refresh</button>
    </div>

    <div v-if="forbidden" class="card msg">
      <p>This page is for the admin account only.</p>
      <RouterLink to="/" class="link">← Back to the app</RouterLink>
    </div>

    <div v-else-if="loading" class="card msg"><div class="spin"></div><p>Loading…</p></div>
    <div v-else-if="error" class="card msg">
      <p>{{ error }}</p>
      <button class="btn btn-ghost" @click="load">Try again</button>
    </div>

    <template v-else-if="data">
      <!-- KPIs -->
      <div class="kpis">
        <div class="kpi"><div class="k-val">{{ data.users.total }}</div><div class="k-lab">Signed up</div></div>
        <div class="kpi"><div class="k-val accent">{{ data.users.active_7d }}</div><div class="k-lab">Active (7d)</div></div>
        <div class="kpi"><div class="k-val">{{ data.users.logged_food }}</div><div class="k-lab">Logged food</div></div>
        <div class="kpi"><div class="k-val">{{ activationPct }}%</div><div class="k-lab">Activation</div></div>
        <div class="kpi"><div class="k-val">{{ fmt(data.content.total_entries) }}</div><div class="k-lab">Total entries</div></div>
        <div class="kpi"><div class="k-val">{{ fmt(data.content.entries_7d) }}</div><div class="k-lab">Entries (7d)</div></div>
      </div>

      <!-- Cost -->
      <div class="grid2">
        <div class="card cost">
          <h2>AI cost <span class="muted small">· last 30 days</span></h2>
          <template v-if="data.ai">
            <div class="cost-big mono">${{ data.ai.cost_usd.toFixed(2) }}</div>
            <div class="cost-sub muted">≈ ₹{{ Math.round(data.ai.cost_usd * 84) }} · {{ fmt(data.ai.invocations) }} AI calls</div>
            <div class="cost-rows">
              <div class="cr"><span>Input tokens</span><span class="mono">{{ fmt(data.ai.input_tokens) }}</span></div>
              <div class="cr"><span>Output tokens</span><span class="mono">{{ fmt(data.ai.output_tokens) }}</span></div>
              <div class="cr"><span>Per AI call</span><span class="mono">${{ perAction.toFixed(4) }}</span></div>
              <div class="cr muted small"><span>Rates (Gemini 2.5 Flash)</span><span class="mono">${{ data.ai.input_rate_per_m }} / ${{ data.ai.output_rate_per_m }} per 1M</span></div>
            </div>
          </template>
          <p v-else class="muted">Vertex usage unavailable (not configured or Monitoring error).</p>
        </div>

        <div class="card cost">
          <h2>Running cost</h2>
          <div class="cost-big mono">${{ totalMonthly.toFixed(2) }}<span class="permo">/mo</span></div>
          <div class="cost-sub muted">estimated total</div>
          <div class="cost-rows">
            <div class="cr"><span>Hosting (Railway)</span><span class="mono">~${{ data.railway_estimate_usd.toFixed(2) }}</span></div>
            <div class="cr"><span>AI (Vertex)</span><span class="mono">${{ (data.ai?.cost_usd ?? 0).toFixed(2) }}</span></div>
            <div class="cr"><span>Foods in library</span><span class="mono">{{ fmt(data.content.foods) }}</span></div>
            <div class="cr"><span>Weigh-ins</span><span class="mono">{{ fmt(data.content.weigh_ins) }}</span></div>
          </div>
        </div>
      </div>

      <!-- Users -->
      <h2 class="usersh">Users <span class="muted small">· {{ data.users.total }}</span></h2>
      <div class="card tablecard">
        <table>
          <thead>
            <tr><th>Name</th><th>Email</th><th>Signed up</th><th class="num">Entries</th><th class="num">Days</th><th>Last log</th><th>Status</th></tr>
          </thead>
          <tbody>
            <tr v-for="u in data.users.list" :key="u.email">
              <td>{{ u.name }} <span v-if="u.role === 'admin'" class="tag">admin</span></td>
              <td class="muted em">{{ u.email }}</td>
              <td class="mono">{{ u.signed_up }}</td>
              <td class="num mono">{{ u.entries }}</td>
              <td class="num mono">{{ u.days_logged }}</td>
              <td class="mono">{{ u.last_log ?? '—' }}</td>
              <td>
                <span v-if="u.active_7d" class="dot on">Active</span>
                <span v-else-if="u.entries > 0" class="dot idle">Dormant</span>
                <span v-else class="dot cold">No logs</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="foot muted small">Updated {{ new Date(data.generated_at).toLocaleString() }} · AI figures cached ~30 min.</p>
    </template>
  </div>
</template>

<style scoped>
.admin {
  max-width: 1080px;
  margin: 0 auto;
  padding: 24px 20px calc(40px + env(safe-area-inset-bottom));
  padding-top: calc(20px + env(safe-area-inset-top));
}

.head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 18px;
}

.eyebrow {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--accent);
  margin: 0 0 6px;
}

h1 {
  font-size: 26px;
  margin: 0;
}

.refresh {
  font-size: 13px;
  color: var(--text-dim);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 8px 14px;
  min-height: 38px;
}

.msg {
  text-align: center;
  padding: 40px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.spin {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 3px solid var(--surface-2);
  border-top-color: var(--accent);
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.kpi {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 16px 18px;
}

.k-val {
  font-size: 30px;
  font-weight: 800;
  line-height: 1;
}

.k-val.accent { color: var(--accent); }

.k-lab {
  font-size: 12px;
  color: var(--text-dim);
  margin-top: 6px;
}

.grid2 {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 12px;
  margin-bottom: 8px;
}

.cost h2 {
  margin: 0 0 12px;
  font-size: 15px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.cost-big {
  font-size: 46px;
  font-weight: 800;
  color: var(--accent);
  line-height: 1;
}

.permo {
  font-size: 20px;
  color: var(--text-dim);
  font-weight: 500;
}

.cost-sub {
  font-size: 13px;
  margin: 6px 0 14px;
}

.cost-rows { display: flex; flex-direction: column; }

.cr {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-top: 1px solid var(--border);
  font-size: 14px;
}

.small { font-size: 12px; }

.usersh {
  margin: 22px 0 10px;
  font-size: 15px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.tablecard {
  padding: 0;
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

th, td {
  text-align: left;
  padding: 12px 14px;
  white-space: nowrap;
}

th {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-dim);
  border-bottom: 1px solid var(--border);
}

tbody tr { border-bottom: 1px solid var(--border); }
tbody tr:last-child { border-bottom: none; }

.num { text-align: right; }
.em { word-break: break-all; }

.tag {
  font-size: 10px;
  background: rgba(74, 222, 128, 0.15);
  color: var(--accent);
  padding: 2px 6px;
  border-radius: 6px;
  margin-left: 6px;
}

.dot {
  font-size: 12px;
  padding: 3px 9px;
  border-radius: 999px;
  font-weight: 600;
}
.dot.on { background: rgba(74, 222, 128, 0.15); color: var(--accent); }
.dot.idle { background: rgba(251, 191, 36, 0.15); color: var(--warn); }
.dot.cold { background: var(--surface-2); color: var(--text-dim); }

.foot { margin-top: 14px; }
.link { color: var(--accent); text-decoration: none; }
</style>
