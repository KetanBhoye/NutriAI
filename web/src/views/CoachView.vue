<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { addDays, parseISODate, todayISO } from '../dates';
import {
  coachActiveDate,
  coachBubbles,
  coachHistory,
  type CoachHistoryTurn as HistoryTurn,
} from '../coach-state';

const configured = ref<boolean | null>(null);
// Held in a module store so the conversation survives tab switches (this view
// unmounts on navigation).
const bubbles = coachBubbles;
const history = coachHistory;
const input = ref('');
const sending = ref(false);
const scroller = ref<HTMLElement | null>(null);
const textarea = ref<HTMLTextAreaElement | null>(null);

// ── Push-to-talk (Web Speech API) ─────────────────────────
type SR = typeof window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
const SRCtor = (window as SR).SpeechRecognition || (window as SR).webkitSpeechRecognition;
const speechSupported = Boolean(SRCtor);
const listening = ref(false);
let recognition: SpeechRecognitionLike | null = null;
let baseText = '';

function toggleMic(): void {
  if (!SRCtor) return;
  if (listening.value) {
    recognition?.stop();
    return;
  }
  baseText = input.value ? input.value.trim() + ' ' : '';
  recognition = new SRCtor();
  recognition.lang = navigator.language || 'en-US';
  recognition.interimResults = true;
  recognition.continuous = true;
  recognition.onresult = (e) => {
    let transcript = '';
    for (let i = 0; i < e.results.length; i += 1) transcript += e.results[i][0].transcript;
    input.value = baseText + transcript;
    grow();
  };
  recognition.onerror = () => {
    listening.value = false;
  };
  recognition.onend = () => {
    listening.value = false;
    recognition = null;
    nextTick(() => textarea.value?.focus());
  };
  try {
    recognition.start();
    listening.value = true;
    if (navigator.vibrate) navigator.vibrate(6);
  } catch {
    listening.value = false;
  }
}

/** Tappable starter prompts shown on the empty state. */
const SUGGESTIONS = [
  '2 rotis, a bowl of dal and 3 boiled eggs for lunch',
  'How much protein do I have left today?',
  "What's my calorie count so far?",
  'I weighed 71.2 kg this morning',
];

// The day the coach acts on: logging, weigh-ins and "what did I eat" default
// here unless the user names another day in their message.
const today = todayISO();
// From the module store so the chosen day persists across tab switches too.
const activeDate = coachActiveDate;

function shiftDate(days: number): void {
  const next = addDays(activeDate.value, days);
  if (next > today) return; // no logging into the future
  activeDate.value = next;
}

const isToday = computed(() => activeDate.value === today);

const dateLabel = computed(() => {
  if (isToday.value) return 'Today';
  if (activeDate.value === addDays(today, -1)) return 'Yesterday';
  return parseISODate(activeDate.value).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });
});

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

/** Grows the composer textarea to fit its content, up to a few lines. */
function grow(): void {
  const el = textarea.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
}

function resetComposer(): void {
  input.value = '';
  nextTick(() => {
    if (textarea.value) textarea.value.style.height = 'auto';
  });
}

function onEnter(event: KeyboardEvent): void {
  // Enter sends; Shift+Enter (or IME composing) inserts a newline.
  if (event.isComposing) return;
  event.preventDefault();
  void send();
}

function useSuggestion(text: string): void {
  input.value = text;
  void send();
}

async function send(): Promise<void> {
  if (listening.value) recognition?.stop();
  const message = input.value.trim();
  if (!message || sending.value) return;

  // Pin the date this turn acts on, so a later date change doesn't move the link.
  const sentDate = activeDate.value;
  bubbles.value.push({ id: crypto.randomUUID(), from: 'user', text: message });
  resetComposer();
  sending.value = true;
  await scrollDown();

  try {
    const res = await fetch('/api/coach/chat', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history: history.value, active_date: sentDate }),
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
    const changed = result.actions.some((a) => ACTIONS_THAT_CHANGE_LOG.has(a));
    bubbles.value.push({
      id: crypto.randomUUID(),
      from: 'coach',
      text: result.reply,
      changedLog: changed,
      logDate: changed ? sentDate : undefined,
    });
    if (changed && navigator.vibrate) navigator.vibrate(8);
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

// ── iOS keyboard handling ─────────────────────────────────
// iOS Safari ignores viewport `interactive-widget`, and 100dvh does not shrink
// when the keyboard opens — so the composer would hide behind it. Track the
// visual viewport and pin the chat to its height while the keyboard is up.
const kbInset = ref(0);

function onViewport(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  // How much of the layout viewport the keyboard (and toolbars) now cover.
  const covered = window.innerHeight - vv.height - vv.offsetTop;
  kbInset.value = covered > 80 ? covered : 0;
  if (kbInset.value > 0) void scrollDown();
}

const coachStyle = computed(() =>
  kbInset.value > 0
    ? { height: `calc(100dvh - ${Math.round(kbInset.value)}px)`, paddingBottom: '0' }
    : undefined
);

onMounted(() => {
  checkConfigured();
  // Returning to the tab: restore scroll to the latest message.
  if (bubbles.value.length) void scrollDown();
  window.visualViewport?.addEventListener('resize', onViewport);
  window.visualViewport?.addEventListener('scroll', onViewport);
});

onUnmounted(() => {
  window.visualViewport?.removeEventListener('resize', onViewport);
  window.visualViewport?.removeEventListener('scroll', onViewport);
});
</script>

<template>
  <div class="coach-view" :style="coachStyle">
    <header class="chat-head">
      <div class="head-title">
        <div class="avatar">🥗</div>
        <div>
          <h1>Coach</h1>
          <p class="head-sub">Acting on {{ dateLabel.toLowerCase() }}</p>
        </div>
      </div>
      <div class="date-nav">
        <button class="nav-btn" aria-label="Previous day" @click="shiftDate(-1)">‹</button>
        <div class="date-pill" :class="{ past: !isToday }">
          <span class="dl">{{ dateLabel }}</span>
          <span class="ds mono">{{ activeDate }}</span>
        </div>
        <button class="nav-btn" aria-label="Next day" :disabled="isToday" @click="shiftDate(1)">›</button>
      </div>
    </header>

    <div v-if="configured === false" class="notice">
      <p style="margin: 0">
        The Coach isn't switched on for this server yet — it needs the AI provider configured.
        Until then, log foods from the Today tab.
      </p>
    </div>

    <template v-else>
      <div ref="scroller" class="thread">
        <div v-if="bubbles.length === 0" class="empty">
          <div class="empty-avatar">🥗</div>
          <h2 class="empty-title">Hey — I'm your coach</h2>
          <p class="empty-sub">
            Tell me what you ate, ask how your day's going, or update your weight. Try one:
          </p>
          <div class="chips">
            <button v-for="s in SUGGESTIONS" :key="s" class="chip" @click="useSuggestion(s)">
              {{ s }}
            </button>
          </div>
        </div>

        <template v-else>
          <!-- Pushes a short conversation down to sit near the composer. -->
          <div class="spacer"></div>
          <div v-for="b in bubbles" :key="b.id" class="bubble-row" :class="b.from">
            <div v-if="b.from === 'coach'" class="mini-avatar">🥗</div>
            <div class="bubble" :class="b.from">
              <p class="bubble-text">{{ b.text }}</p>
              <RouterLink
                v-if="b.changedLog"
                :to="!b.logDate || b.logDate === today ? '/' : { path: '/', query: { date: b.logDate } }"
                class="changed"
              >
                ✓ updated your log — view {{ !b.logDate || b.logDate === today ? 'Today' : b.logDate }}
              </RouterLink>
            </div>
          </div>
        </template>

        <div v-if="sending" class="bubble-row coach">
          <div class="mini-avatar">🥗</div>
          <div class="bubble coach typing"><span></span><span></span><span></span></div>
        </div>
      </div>

      <form class="composer" @submit.prevent="send">
        <div class="composer-pill" :class="{ listening }">
          <button
            v-if="speechSupported"
            type="button"
            class="mic-btn"
            :class="{ on: listening }"
            :aria-label="listening ? 'Stop dictation' : 'Dictate'"
            @click="toggleMic"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z M6 11a6 6 0 0 0 12 0 M12 19v3"
                fill="none"
                stroke="currentColor"
                stroke-width="1.9"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
          <textarea
            ref="textarea"
            v-model="input"
            class="composer-input"
            rows="1"
            :placeholder="listening ? 'Listening…' : 'Message your coach…'"
            autocomplete="off"
            enterkeyhint="send"
            :disabled="sending"
            @input="grow"
            @keydown.enter="onEnter"
          ></textarea>
          <button
            class="send-btn"
            type="submit"
            aria-label="Send"
            :disabled="sending || !input.trim()"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                d="M12 19V5M12 5l-6 6M12 5l6 6"
                fill="none"
                stroke="currentColor"
                stroke-width="2.4"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        </div>
      </form>
    </template>
  </div>
</template>

<style scoped>
/* NB: named .coach-view, NOT .coach — coach message bubbles carry class="coach"
   (from :class="b.from"), and a `.coach { height: ... }` rule would match those
   bubbles too and stretch each one to the full container height. That collision
   was the "giant bubble" bug. */
.coach-view {
  display: flex;
  flex-direction: column;
  /* #app already reserves 72px + safe-area below for the fixed tab bar, so the
     chat fills exactly the space above it — no own bottom padding, which would
     double-count and make the page scroll. */
  height: calc(100dvh - 72px - env(safe-area-inset-bottom));
  max-width: 640px;
  margin: 0 auto;
}

/* ── Header ─────────────────────────────────────────────── */
.chat-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 16px;
  padding-top: calc(10px + env(safe-area-inset-top));
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}

.head-title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.avatar {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  font-size: 20px;
  border-radius: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
}

.chat-head h1 {
  font-size: 18px;
  margin: 0;
  line-height: 1.1;
}

.head-sub {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--text-dim);
}

.date-nav {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.nav-btn {
  width: 32px;
  min-height: 38px;
  font-size: 22px;
  color: var(--text-dim);
  border-radius: 8px;
  flex-shrink: 0;
}

.nav-btn:disabled {
  opacity: 0.25;
}

.nav-btn:active:not(:disabled) {
  background: var(--surface-2);
}

.date-pill {
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1.1;
  min-width: 72px;
  padding: 3px 4px;
  border-radius: 9px;
}

.date-pill.past {
  background: var(--surface-2);
  border: 1px solid var(--border);
}

.date-pill .dl {
  font-size: 13px;
  font-weight: 600;
}

.date-pill .ds {
  font-size: 10px;
  color: var(--text-dim);
}

.notice {
  margin: 16px;
  font-size: 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
}

/* ── Thread ─────────────────────────────────────────────── */
/* A flex column scroll area. min-height:0 lets it actually scroll inside the
   parent flex column. A leading .spacer (flex:1) pushes a short conversation
   down to the composer; rows are flex:0 0 auto so a bubble can NEVER stretch to
   fill the column (the earlier "giant empty bubble" bug). */
.thread {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}

/* Nothing in the thread may grow vertically — only the spacer does. This is the
   guard against a bubble stretching to fill the column (an iOS Safari flexbox
   quirk). */
.thread > * {
  flex: 0 0 auto;
}

.spacer {
  flex: 1 1 auto;
  min-height: 0;
}

/* ── Empty state ────────────────────────────────────────── */
.empty {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 24px 8px;
}

.empty-avatar {
  width: 60px;
  height: 60px;
  display: grid;
  place-items: center;
  font-size: 32px;
  border-radius: 18px;
  background: var(--surface);
  border: 1px solid var(--border);
  margin-bottom: 14px;
}

.empty-title {
  font-size: 19px;
  font-weight: 700;
  color: var(--text);
  text-transform: none;
  letter-spacing: normal;
  margin: 0 0 6px;
}

.empty-sub {
  font-size: 14px;
  color: var(--text-dim);
  margin: 0 0 18px;
  max-width: 300px;
}

.chips {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: 340px;
}

.chip {
  text-align: left;
  font-size: 14px;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 12px 15px;
  line-height: 1.35;
  transition: transform 0.12s ease, border-color 0.12s ease;
}

.chip:active {
  transform: scale(0.98);
  border-color: var(--accent-dim);
}

/* ── Bubbles ────────────────────────────────────────────── */
.bubble-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  margin-bottom: 12px;
}

/* User messages sit on the right; row-reverse keeps the bubble flush right. */
.bubble-row.user {
  flex-direction: row-reverse;
}

.mini-avatar {
  flex: none;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  font-size: 14px;
  border-radius: 9px;
  background: var(--surface);
  border: 1px solid var(--border);
}

.bubble {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 82%;
  border-radius: 18px;
  padding: 10px 14px;
}

.bubble.user {
  background: var(--accent);
  color: #06210f;
  border-bottom-right-radius: 5px;
}

.bubble.coach {
  background: var(--surface);
  border: 1px solid var(--border);
  border-bottom-left-radius: 5px;
}

.bubble-text {
  margin: 0;
  font-size: 15px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

.changed {
  display: inline-flex;
  align-items: center;
  margin-top: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
  text-decoration: none;
}

/* Message entrance. */
.pop-enter-active {
  transition: opacity 0.22s ease, transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.pop-enter-from {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}

/* ── Composer ───────────────────────────────────────────── */
.composer {
  flex-shrink: 0;
  padding: 8px 12px 10px;
  background: var(--bg);
  border-top: 1px solid var(--border);
}

.composer-pill {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 22px;
  padding: 5px 5px 5px 5px;
  transition: border-color 0.15s ease;
}

.composer-pill.listening {
  border-color: var(--accent);
}

.mic-btn {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  min-height: 38px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: var(--text-dim);
  background: transparent;
}

.mic-btn.on {
  color: #06210f;
  background: var(--accent);
  animation: pulse 1.4s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.5);
  }
  50% {
    box-shadow: 0 0 0 7px rgba(74, 222, 128, 0);
  }
}

.composer-input {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 16px;
  line-height: 1.4;
  padding: 8px 6px;
  margin: 0;
  min-height: 24px;
  max-height: 120px;
  width: auto;
  resize: none;
  outline: none;
}

.composer-input:focus {
  outline: none;
}

.composer-input::placeholder {
  color: var(--text-dim);
}

.send-btn {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  min-height: 38px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--accent);
  color: #06210f;
  transition: transform 0.12s ease, opacity 0.12s ease, background 0.12s ease;
}

.send-btn:active:not(:disabled) {
  transform: scale(0.9);
}

.send-btn:disabled {
  background: var(--surface);
  color: var(--text-dim);
  opacity: 1;
}

/* ── Typing indicator ───────────────────────────────────── */
.typing {
  display: flex;
  align-items: center;
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
