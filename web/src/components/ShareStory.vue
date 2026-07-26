<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { api } from '../api';
import { buildStoryCard, shareCard } from '../share';

const props = defineProps<{ date: string }>();
const emit = defineEmits<{ close: [] }>();

const previewUrl = ref<string | null>(null);
const loading = ref(true);
const errored = ref(false);
const sharing = ref(false);
const note = ref<string | null>(null);
let blob: Blob | null = null;

async function build(): Promise<void> {
  loading.value = true;
  errored.value = false;
  try {
    const stats = await api.shareStats(props.date);
    blob = await buildStoryCard(stats);
    previewUrl.value = URL.createObjectURL(blob);
  } catch {
    errored.value = true;
  } finally {
    loading.value = false;
  }
}

async function onShare(): Promise<void> {
  if (!blob) return;
  sharing.value = true;
  note.value = null;
  const result = await shareCard(blob);
  if (result === 'downloaded') note.value = 'Saved to your device — post it to your story from there.';
  else if (result === 'error') note.value = 'Sharing failed. Try Save instead.';
  sharing.value = false;
}

async function onDownload(): Promise<void> {
  if (!blob) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `nutriai-${props.date}.png`;
  a.click();
  URL.revokeObjectURL(a.href);
  note.value = 'Saved to your device.';
}

onMounted(build);
onUnmounted(() => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
});
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="sheet">
      <div class="sheet-head">
        <span class="sheet-title">Share your day</span>
        <button class="x" aria-label="Close" @click="emit('close')">✕</button>
      </div>

      <div class="preview">
        <div v-if="loading" class="ph">
          <div class="spin"></div>
          <p>Building your card…</p>
        </div>
        <div v-else-if="errored" class="ph">
          <p>Couldn't build your card.</p>
          <button class="btn btn-ghost" @click="build">Try again</button>
        </div>
        <img v-else-if="previewUrl" :src="previewUrl" alt="Your day on NutriAI" />
      </div>

      <p v-if="note" class="note">{{ note }}</p>

      <div class="actions">
        <button class="btn grow" :disabled="loading || sharing || errored" @click="onShare">
          {{ sharing ? 'Opening…' : 'Share to story' }}
        </button>
        <button class="btn btn-ghost" :disabled="loading || errored" @click="onDownload">Save</button>
      </div>
      <p class="hint muted">Share to Instagram Stories, Snapchat, WhatsApp — or save & post it yourself.</p>
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
  max-width: 440px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 20px 20px 0 0;
  padding: 16px 16px calc(20px + env(safe-area-inset-bottom));
  max-height: 92dvh;
  display: flex;
  flex-direction: column;
}

.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
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

.preview {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.preview img {
  max-height: 62dvh;
  max-width: 100%;
  border-radius: 16px;
  border: 1px solid var(--border);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
}

.ph {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: var(--text-dim);
  font-size: 14px;
  padding: 60px 0;
}

.spin {
  width: 30px;
  height: 30px;
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

.actions {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}

.grow {
  flex: 1;
}

.note {
  font-size: 13px;
  color: var(--accent);
  text-align: center;
  margin: 12px 0 0;
}

.hint {
  font-size: 12px;
  text-align: center;
  margin: 10px 0 0;
}
</style>
