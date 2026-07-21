<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import { api, type MealType } from '../api';

interface ParsedItem {
  food_name: string;
  quantity: number;
  unit: string;
  meal_type: MealType;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

interface Bubble {
  id: string;
  from: 'user' | 'coach';
  text?: string;
  /** Parsed items awaiting confirmation, attached to a coach bubble. */
  items?: ParsedItem[];
  logged?: boolean;
}

const configured = ref<boolean | null>(null);
const bubbles = ref<Bubble[]>([]);
const input = ref('');
const sending = ref(false);
const scroller = ref<HTMLElement | null>(null);

async function checkConfigured(): Promise<void> {
  try {
    const res = await fetch('/api/ai/status', { credentials: 'same-origin' });
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }
    configured.value = (await res.json()).configured === true;
  } catch {
    configured.value = false;
  }
}

async function scrollDown(): Promise<void> {
  await nextTick();
  scroller.value?.scrollTo({ top: scroller.value.scrollHeight, behavior: 'smooth' });
}

async function send(): Promise<void> {
  const message = input.value.trim();
  if (!message || sending.value) return;

  bubbles.value.push({ id: crypto.randomUUID(), from: 'user', text: message });
  input.value = '';
  sending.value = true;
  await scrollDown();

  try {
    const res = await fetch('/api/ai/parse', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });

    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }
    if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))) as { error?: string };
      bubbles.value.push({
        id: crypto.randomUUID(),
        from: 'coach',
        text: detail.error ?? 'Something went wrong. Try again.',
      });
      return;
    }

    const result = (await res.json()) as {
      understood: boolean;
      clarification: string | null;
      items: ParsedItem[];
    };

    if (!result.understood || result.items.length === 0) {
      bubbles.value.push({
        id: crypto.randomUUID(),
        from: 'coach',
        text: result.clarification ?? "I couldn't read that as food. Try naming the item and amount.",
      });
    } else {
      const total = result.items.reduce((sum, i) => sum + i.calories, 0);
      bubbles.value.push({
        id: crypto.randomUUID(),
        from: 'coach',
        text: `Got it — ${result.items.length} item${result.items.length > 1 ? 's' : ''}, ${total} kcal. Log ${result.items.length > 1 ? 'them' : 'it'}?`,
        items: result.items,
      });
    }
  } catch {
    bubbles.value.push({
      id: crypto.randomUUID(),
      from: 'coach',
      text: 'Network error. Try again, or add the food manually.',
    });
  } finally {
    sending.value = false;
    await scrollDown();
  }
}

/** Confirmation is where LLM output actually enters the log. */
function confirm(bubble: Bubble): void {
  if (!bubble.items) return;
  for (const item of bubble.items) {
    api.createEntry({
      food_name: item.food_name,
      calories: item.calories,
      protein_g: item.protein_g,
      carbs_g: item.carbs_g,
      fat_g: item.fat_g,
      meal_type: item.meal_type,
      entry_date: new Date().toLocaleDateString('en-CA'),
    });
  }
  bubble.logged = true;
  if (navigator.vibrate) navigator.vibrate(8);
}

function editItem(bubble: Bubble, index: number, field: keyof ParsedItem, value: string): void {
  if (!bubble.items) return;
  const item = bubble.items[index]!;
  if (field === 'food_name' || field === 'unit' || field === 'meal_type') {
    (item[field] as string) = value;
  } else {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) (item[field] as number) = n;
  }
}

onMounted(checkConfigured);
</script>

<template>
  <div class="page coach">
    <header>
      <h1>Coach</h1>
      <p class="muted sub">Tell me what you ate and I'll work out the macros.</p>
    </header>

    <div v-if="configured === false" class="card notice">
      <p style="margin: 0">
        AI logging isn't switched on for this server yet. It needs an API key in the server config
        (<code>ANTHROPIC_API_KEY</code> or <code>OPENAI_API_KEY</code>). Until then, log foods from
        the Today tab.
      </p>
    </div>

    <template v-else>
      <div ref="scroller" class="thread">
        <div v-if="bubbles.length === 0" class="empty muted">
          <p>Try: “2 rotis, a bowl of dal and 100g curd for lunch”</p>
        </div>

        <div v-for="b in bubbles" :key="b.id" class="bubble-row" :class="b.from">
          <div class="bubble" :class="b.from">
            <p v-if="b.text" class="bubble-text">{{ b.text }}</p>

            <div v-if="b.items && !b.logged" class="items">
              <div v-for="(item, i) in b.items" :key="i" class="item">
                <input
                  class="item-name"
                  :value="item.food_name"
                  @input="editItem(b, i, 'food_name', ($event.target as HTMLInputElement).value)"
                />
                <div class="macros">
                  <label>kcal<input type="number" inputmode="numeric" :value="item.calories" @input="editItem(b, i, 'calories', ($event.target as HTMLInputElement).value)" /></label>
                  <label>P<input type="number" inputmode="decimal" :value="item.protein_g" @input="editItem(b, i, 'protein_g', ($event.target as HTMLInputElement).value)" /></label>
                  <label>C<input type="number" inputmode="decimal" :value="item.carbs_g" @input="editItem(b, i, 'carbs_g', ($event.target as HTMLInputElement).value)" /></label>
                  <label>F<input type="number" inputmode="decimal" :value="item.fat_g" @input="editItem(b, i, 'fat_g', ($event.target as HTMLInputElement).value)" /></label>
                </div>
                <select
                  class="meal"
                  :value="item.meal_type"
                  @change="editItem(b, i, 'meal_type', ($event.target as HTMLSelectElement).value)"
                >
                  <option value="breakfast">Breakfast</option>
                  <option value="lunch">Lunch</option>
                  <option value="dinner">Dinner</option>
                  <option value="snack">Snack</option>
                </select>
              </div>
              <button class="btn confirm" @click="confirm(b)">
                Log {{ b.items.length }} item{{ b.items.length > 1 ? 's' : '' }}
              </button>
            </div>

            <p v-if="b.logged" class="logged-note">✓ Logged. Check the Today tab.</p>
          </div>
        </div>

        <div v-if="sending" class="bubble-row coach">
          <div class="bubble coach typing"><span></span><span></span><span></span></div>
        </div>
      </div>

      <form class="composer" @submit.prevent="send">
        <input
          v-model="input"
          type="text"
          placeholder="What did you eat?"
          autocomplete="off"
          :disabled="sending"
        />
        <button class="btn send" type="submit" :disabled="sending || !input.trim()">Send</button>
      </form>
    </template>
  </div>
</template>

<style scoped>
.coach {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  padding-bottom: calc(72px + env(safe-area-inset-bottom));
}

header {
  flex-shrink: 0;
}

.sub {
  font-size: 14px;
  margin: 2px 0 0;
}

.notice {
  margin-top: 16px;
  font-size: 14px;
}

.notice code {
  font-family: var(--mono);
  font-size: 12px;
}

.thread {
  flex: 1;
  overflow-y: auto;
  margin: 16px 0;
  -webkit-overflow-scrolling: touch;
}

.empty {
  text-align: center;
  padding: 40px 16px;
  font-size: 14px;
}

.bubble-row {
  display: flex;
  margin-bottom: 10px;
}

.bubble-row.user {
  justify-content: flex-end;
}

.bubble {
  max-width: 85%;
  border-radius: 16px;
  padding: 10px 14px;
}

.bubble.user {
  background: var(--accent);
  color: #06210f;
  border-bottom-right-radius: 4px;
}

.bubble.coach {
  background: var(--surface);
  border: 1px solid var(--border);
  border-bottom-left-radius: 4px;
}

.bubble-text {
  margin: 0;
  font-size: 15px;
  line-height: 1.4;
}

.items {
  margin-top: 10px;
}

.item {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 8px;
  margin-bottom: 8px;
}

.item-name {
  width: 100%;
  font-size: 14px;
  padding: 6px 8px;
  min-height: auto;
  margin-bottom: 6px;
}

.macros {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}

.macros label {
  display: flex;
  flex-direction: column;
  font-size: 10px;
  color: var(--text-dim);
  gap: 2px;
}

.macros input {
  font-size: 13px;
  padding: 5px 4px;
  text-align: center;
  min-height: auto;
}

.meal {
  margin-top: 6px;
  font-size: 13px;
  padding: 6px 8px;
  min-height: auto;
}

.confirm {
  width: 100%;
  margin-top: 4px;
}

.logged-note {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--accent);
}

.composer {
  flex-shrink: 0;
  display: flex;
  gap: 8px;
}

.send {
  flex-shrink: 0;
  padding: 12px 18px;
}

.typing {
  display: flex;
  gap: 4px;
  padding: 14px;
}

.typing span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-dim);
  animation: blink 1.2s infinite;
}

.typing span:nth-child(2) {
  animation-delay: 0.2s;
}

.typing span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes blink {
  0%, 60%, 100% {
    opacity: 0.3;
  }
  30% {
    opacity: 1;
  }
}
</style>
