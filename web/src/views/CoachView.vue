<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';

interface Bubble {
  id: string;
  from: 'user' | 'coach';
  text: string;
  changedLog?: boolean;
}

/** Raw Gemini turn history, echoed back each request so the agent has context. */
type HistoryTurn = { role: 'user' | 'model'; parts: unknown[] };

const configured = ref<boolean | null>(null);
const bubbles = ref<Bubble[]>([]);
const history = ref<HistoryTurn[]>([]);
const input = ref('');
const sending = ref(false);
const scroller = ref<HTMLElement | null>(null);

const ACTIONS_THAT_CHANGE_LOG = new Set(['add_entry', 'update_entry', 'delete_entry']);

async function checkConfigured(): Promise<void> {
  try {
    const res = await fetch('/api/ai/status', { credentials: 'same-origin' });
    if (res.status === 401) {
      window.location.href = '/app/login';
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
    const res = await fetch('/api/coach/chat', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history: history.value }),
    });

    if (res.status === 401) {
      window.location.href = '/app/login';
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
      reply: string;
      actions: string[];
      history: HistoryTurn[];
    };
    history.value = result.history;
    bubbles.value.push({
      id: crypto.randomUUID(),
      from: 'coach',
      text: result.reply,
      changedLog: result.actions.some((a) => ACTIONS_THAT_CHANGE_LOG.has(a)),
    });
    if (result.actions.some((a) => ACTIONS_THAT_CHANGE_LOG.has(a)) && navigator.vibrate) {
      navigator.vibrate(8);
    }
  } catch {
    bubbles.value.push({
      id: crypto.randomUUID(),
      from: 'coach',
      text: 'Network error. Try again in a moment.',
    });
  } finally {
    sending.value = false;
    await scrollDown();
  }
}

onMounted(checkConfigured);
</script>

<template>
  <div class="page coach">
    <header>
      <h1>Coach</h1>
      <p class="muted sub">Log food, check your day, or ask anything — I can act on your log.</p>
    </header>

    <div v-if="configured === false" class="card notice">
      <p style="margin: 0">
        The Coach isn't switched on for this server yet — it needs the AI provider configured.
        Until then, log foods from the Today tab.
      </p>
    </div>

    <template v-else>
      <div ref="scroller" class="thread">
        <div v-if="bubbles.length === 0" class="empty muted">
          <p>Try:</p>
          <p class="eg">“2 rotis, a bowl of dal and 3 boiled eggs for lunch”</p>
          <p class="eg">“how much protein do I have left today?”</p>
          <p class="eg">“delete the diet coke I just added”</p>
        </div>

        <div v-for="b in bubbles" :key="b.id" class="bubble-row" :class="b.from">
          <div class="bubble" :class="b.from">
            <p class="bubble-text">{{ b.text }}</p>
            <RouterLink v-if="b.changedLog" to="/" class="changed">✓ updated your log — view Today</RouterLink>
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
          placeholder="Message your coach…"
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

.thread {
  flex: 1;
  overflow-y: auto;
  margin: 16px 0;
  -webkit-overflow-scrolling: touch;
}

.empty {
  text-align: center;
  padding: 32px 16px;
  font-size: 14px;
}

.empty .eg {
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px 14px;
  margin: 8px auto;
  max-width: 320px;
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
  line-height: 1.45;
  white-space: pre-wrap;
}

.changed {
  display: inline-block;
  margin-top: 8px;
  font-size: 13px;
  color: var(--accent);
  text-decoration: none;
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
