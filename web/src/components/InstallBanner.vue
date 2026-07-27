<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { canInstall, isInstalled, isIOS, promptInstall } from '../install';

const DISMISS_KEY = 'nutriai-install-dismissed';

const dismissed = ref(false);
const iosMode = ref(false);

// Show when we can actually install (Android prompt ready, or iOS Safari that
// isn't installed yet) and the user hasn't dismissed it this session-ish.
const show = computed(() => !isInstalled.value && !dismissed.value && (canInstall.value || iosMode.value));

function close(): void {
  dismissed.value = true;
  try {
    localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    /* private mode — fine */
  }
}

async function install(): Promise<void> {
  await promptInstall();
}

onMounted(() => {
  try {
    dismissed.value = localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    dismissed.value = false;
  }
  // iOS Safari never fires beforeinstallprompt — offer manual steps instead.
  if (isIOS() && !isInstalled.value) iosMode.value = true;
});

// If it gets installed while open, tuck the banner away.
watch(isInstalled, (v) => {
  if (v) dismissed.value = true;
});
</script>

<template>
  <Transition name="slide">
    <div v-if="show" class="install">
      <div class="ic">🍎</div>
      <div class="txt">
        <strong>Install NutriAI</strong>
        <span v-if="iosMode" class="sub">
          Tap the Share icon <span class="share">􀈂</span> then “Add to Home Screen”.
        </span>
        <span v-else class="sub">Add it to your home screen for a full-screen, app-like experience.</span>
      </div>
      <button v-if="!iosMode" class="cta" @click="install">Install</button>
      <button class="x" aria-label="Dismiss" @click="close">✕</button>
    </div>
  </Transition>
</template>

<style scoped>
.install {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  padding-top: calc(12px + env(safe-area-inset-top));
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.ic {
  font-size: 26px;
  flex-shrink: 0;
}

.txt {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.txt strong {
  font-size: 14px;
}

.sub {
  font-size: 12px;
  color: var(--text-dim);
  line-height: 1.35;
}

.share {
  font-family: -apple-system, system-ui;
}

.cta {
  flex-shrink: 0;
  background: var(--accent);
  color: #06210f;
  font-weight: 600;
  font-size: 14px;
  border-radius: 10px;
  padding: 9px 16px;
  min-height: 40px;
}

.x {
  flex-shrink: 0;
  width: 32px;
  min-height: 32px;
  color: var(--text-dim);
  font-size: 15px;
  border-radius: 8px;
}

.slide-enter-active,
.slide-leave-active {
  transition: transform 0.25s ease, opacity 0.25s ease;
}

.slide-enter-from,
.slide-leave-to {
  transform: translateY(-100%);
  opacity: 0;
}
</style>
