<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { api } from '../api';
import TokenCard from '../components/TokenCard.vue';
import { canInstall, isIOS, isInstalled, promptInstall } from '../install';
import {
  currentSubscription,
  disablePush,
  enablePush,
  getPushPublicKey,
  notificationPermission,
  pushSupported,
} from '../push';

const name = ref<string | null>(null);
const email = ref<string | null>(null);
const goals = ref<{ calories?: number | null; protein_g?: number | null } | null>(null);
const isAdmin = ref(false);
const signingOut = ref(false);

// ── Notifications state ───────────────────────────────────
const supported = pushSupported();
const publicKey = ref<string | null>(null);
const subscribed = ref(false);
const permission = ref(notificationPermission());
const pushBusy = ref(false);
const pushMsg = ref<string | null>(null);
const sampleBusy = ref(false);

async function sendSample(): Promise<void> {
  sampleBusy.value = true;
  pushMsg.value = null;
  try {
    const res = await fetch('/api/push/preview-reminder', {
      method: 'POST',
      credentials: 'same-origin',
    });
    const data = (await res.json().catch(() => ({}))) as { delivered?: number };
    pushMsg.value =
      res.ok && (data.delivered ?? 0) > 0
        ? "Sent — that's tonight's reminder based on your log so far."
        : 'Could not send it. Make sure notifications are on for this device.';
  } catch {
    pushMsg.value = 'Could not send it. Try again.';
  } finally {
    sampleBusy.value = false;
  }
}

const pushAvailable = computed(() => supported && publicKey.value !== null);

const initial = computed(() => (name.value?.trim()?.[0] ?? '🙂').toUpperCase());

async function refreshPush(): Promise<void> {
  publicKey.value = await getPushPublicKey();
  subscribed.value = (await currentSubscription()) !== null;
  permission.value = notificationPermission();
}

onMounted(async () => {
  try {
    const me = await api.me();
    name.value = me.name;
    email.value = me.email;
    goals.value = me.goals;
    isAdmin.value = me.role === 'admin';
  } catch {
    /* 401 handler redirects */
  }
  await refreshPush();
});

async function toggleNotifications(): Promise<void> {
  pushMsg.value = null;
  pushBusy.value = true;
  try {
    if (subscribed.value) {
      await disablePush();
      subscribed.value = false;
      pushMsg.value = 'Notifications turned off.';
    } else {
      const result = await enablePush(publicKey.value!);
      if (result === 'enabled') {
        subscribed.value = true;
        pushMsg.value = 'Sent you a test notification — check it just appeared.';
      } else if (result === 'denied') {
        pushMsg.value = 'Permission was blocked. Enable it in your browser settings, then try again.';
      } else if (result === 'unsupported') {
        pushMsg.value = 'This browser can’t do notifications.';
      } else {
        pushMsg.value = 'Something went wrong turning them on. Try again.';
      }
      permission.value = notificationPermission();
    }
  } finally {
    pushBusy.value = false;
  }
}

const installed = isInstalled;
const iosDevice = isIOS();
const installBusy = ref(false);

async function doInstall(): Promise<void> {
  installBusy.value = true;
  try {
    await promptInstall();
  } finally {
    installBusy.value = false;
  }
}

async function signOut(): Promise<void> {
  signingOut.value = true;
  await api.logout();
  window.location.assign('/app/login');
}

// ── Delete account ────────────────────────────────────────
const confirmingDelete = ref(false);
const deleting = ref(false);
const deleteError = ref<string | null>(null);

async function deleteAccount(): Promise<void> {
  deleting.value = true;
  deleteError.value = null;
  try {
    await api.deleteAccount();
    window.location.assign('/app/login');
  } catch (e) {
    deleteError.value =
      e instanceof Error && e.message ? e.message : 'Could not delete the account.';
    deleting.value = false;
  }
}
</script>

<template>
  <div class="page profile">
    <p class="eyebrow">You</p>

    <!-- Identity -->
    <div class="hero card">
      <div class="ava">{{ initial }}</div>
      <div class="who">
        <div class="nm">{{ name ?? '…' }}</div>
        <div class="em muted">{{ email ?? '' }}</div>
      </div>
    </div>

    <!-- Admin (owner only) -->
    <RouterLink v-if="isAdmin" to="/admin" class="card link-card admin-card">
      <div>
        <div class="setting-title">📊 Admin dashboard</div>
        <div class="setting-sub muted">Users, adoption & AI cost</div>
      </div>
      <span class="chev">›</span>
    </RouterLink>

    <!-- Install app -->
    <template v-if="!installed">
      <h2>Install</h2>
      <div class="card">
        <div class="spread">
          <div class="setting-txt">
            <div class="setting-title">Add NutriAI to your home screen</div>
            <div class="setting-sub muted">
              Runs full-screen like a native app — and it's required for
              notifications on iPhone.
            </div>
          </div>
          <button v-if="canInstall" class="install-cta" :disabled="installBusy" @click="doInstall">
            {{ installBusy ? '…' : 'Install' }}
          </button>
        </div>
        <ol v-if="iosDevice && !canInstall" class="ios-steps">
          <li>Tap the <strong>Share</strong> icon in Safari's toolbar.</li>
          <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
          <li>Open NutriAI from the new home-screen icon.</li>
        </ol>
        <p v-else-if="!canInstall" class="hint muted">
          Open this site in Chrome or Safari and use the browser menu → “Add to Home screen”.
        </p>
      </div>
    </template>

    <!-- Notifications -->
    <h2>Notifications</h2>
    <div class="card">
      <div class="spread">
        <div class="setting-txt">
          <div class="setting-title">Meal & goal reminders</div>
          <div class="setting-sub muted">
            Gentle nudges to log meals and stay on your targets.
          </div>
        </div>
        <button
          v-if="pushAvailable && permission !== 'denied'"
          class="switch"
          :class="{ on: subscribed }"
          :disabled="pushBusy"
          role="switch"
          :aria-checked="subscribed"
          @click="toggleNotifications"
        >
          <span class="knob"></span>
        </button>
      </div>

      <p v-if="!supported" class="hint muted">
        Not supported in this browser. On iPhone, install the app to your home screen first, then
        open it and enable this.
      </p>
      <p v-else-if="!pushAvailable" class="hint muted">Not available on this server yet.</p>
      <p v-else-if="permission === 'denied'" class="hint muted">
        Notifications are blocked. Turn them on for this site in your browser settings, then reload.
      </p>
      <p v-if="pushMsg" class="hint accent">{{ pushMsg }}</p>

      <div v-if="subscribed" class="sample-row">
        <span class="hint muted" style="margin: 0">
          A reminder arrives each evening, based on your day's log.
        </span>
        <button class="sample-btn" :disabled="sampleBusy" @click="sendSample">
          {{ sampleBusy ? 'Sending…' : 'Send a sample' }}
        </button>
      </div>
    </div>

    <!-- Goals & plan shortcut -->
    <h2>Goals</h2>
    <RouterLink to="/goals" class="card link-card">
      <div>
        <div class="setting-title">Plan & daily targets</div>
        <div class="setting-sub muted">
          <template v-if="goals?.calories">
            {{ goals.calories }} kcal · {{ goals.protein_g }}g protein
          </template>
          <template v-else>Set your calories, macros and weight goal</template>
        </div>
      </div>
      <span class="chev">›</span>
    </RouterLink>

    <!-- Connections (Claude / MCP token) -->
    <h2>Connections</h2>
    <TokenCard />

    <!-- Sign out -->
    <h2>Account</h2>
    <button class="btn btn-ghost wide danger" :disabled="signingOut" @click="signOut">
      {{ signingOut ? 'Signing out…' : 'Sign out' }}
    </button>

    <!-- Delete account -->
    <div v-if="!confirmingDelete" class="delete-row">
      <button class="delete-link" @click="confirmingDelete = true">Delete account</button>
    </div>
    <div v-else class="card danger-zone">
      <div class="dz-title">Delete your account?</div>
      <p class="dz-body muted">
        This permanently deletes your profile, food log, weigh-ins, goals and all your
        data. This can't be undone.
      </p>
      <p v-if="deleteError" class="dz-error">{{ deleteError }}</p>
      <div class="dz-actions">
        <button class="btn btn-ghost" :disabled="deleting" @click="confirmingDelete = false">
          Cancel
        </button>
        <button class="btn dz-delete" :disabled="deleting" @click="deleteAccount">
          {{ deleting ? 'Deleting…' : 'Delete everything' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.eyebrow {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--accent);
  margin: 0 0 14px;
}

.hero {
  display: flex;
  align-items: center;
  gap: 14px;
}

.ava {
  width: 52px;
  height: 52px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: 16px;
  background: var(--accent);
  color: #06210f;
  font-size: 24px;
  font-weight: 700;
}

.who {
  min-width: 0;
}

.nm {
  font-size: 18px;
  font-weight: 700;
}

.em {
  font-size: 13px;
  word-break: break-word;
}

.setting-txt {
  min-width: 0;
}

.setting-title {
  font-size: 15px;
  font-weight: 500;
}

.setting-sub {
  font-size: 13px;
  margin-top: 2px;
}

.hint {
  font-size: 13px;
  margin: 12px 0 0;
  line-height: 1.45;
}

.hint.accent {
  color: var(--accent);
}

.sample-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}

.sample-btn {
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 8px 12px;
  min-height: 36px;
}

/* iOS-style switch */
.switch {
  flex-shrink: 0;
  width: 50px;
  height: 30px;
  min-height: 30px;
  border-radius: 999px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  position: relative;
  transition: background 0.18s ease;
  padding: 0;
}

.switch.on {
  background: var(--accent);
  border-color: var(--accent);
}

.knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.18s ease;
}

.switch.on .knob {
  transform: translateX(20px);
}

.install-cta {
  flex-shrink: 0;
  background: var(--accent);
  color: #06210f;
  font-weight: 600;
  font-size: 14px;
  border-radius: 10px;
  padding: 9px 16px;
  min-height: 40px;
}

.ios-steps {
  margin: 14px 0 0;
  padding-left: 20px;
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--text-dim);
}

.ios-steps strong {
  color: var(--text);
}

.link-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  text-decoration: none;
  color: inherit;
}

.admin-card {
  margin-top: 14px;
  border-color: rgba(74, 222, 128, 0.3);
}

.chev {
  color: var(--text-dim);
  font-size: 22px;
  flex-shrink: 0;
}

.wide {
  width: 100%;
}

.danger {
  color: var(--danger);
}

.delete-row {
  text-align: center;
  margin-top: 18px;
}

.delete-link {
  font-size: 13px;
  color: var(--text-dim);
  background: none;
  border: none;
  text-decoration: underline;
  min-height: auto;
  padding: 6px;
}

.danger-zone {
  margin-top: 16px;
  border-color: rgba(248, 113, 113, 0.4);
}

.dz-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--danger);
  margin-bottom: 6px;
}

.dz-body {
  font-size: 13px;
  line-height: 1.5;
  margin: 0 0 12px;
}

.dz-error {
  font-size: 13px;
  color: var(--danger);
  margin: 0 0 10px;
}

.dz-actions {
  display: flex;
  gap: 10px;
}

.dz-actions .btn {
  flex: 1;
}

.dz-delete {
  background: var(--danger);
  color: #2a0808;
}
</style>
