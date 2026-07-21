<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';

const email = ref<string | null>(null);
const name = ref<string | null>(null);
const busy = ref(false);

onMounted(async () => {
  try {
    const me = await api.me();
    email.value = me.email;
    name.value = me.name;
  } catch {
    /* the 401 handler will have redirected already */
  }
});

async function logout(): Promise<void> {
  busy.value = true;
  await api.logout();
  // Full navigation clears in-memory state and lands on the auth screen.
  window.location.assign('/app/login');
}
</script>

<template>
  <div class="card">
    <h3 class="title">Account</h3>
    <p class="muted who">
      <template v-if="name">{{ name }} · </template>{{ email ?? '…' }}
    </p>
    <button class="btn btn-ghost wide" :disabled="busy" @click="logout">
      {{ busy ? 'Signing out…' : 'Sign out' }}
    </button>
  </div>
</template>

<style scoped>
.title {
  font-size: 15px;
  margin: 0 0 4px;
}

.who {
  font-size: 13px;
  margin: 0 0 12px;
  word-break: break-word;
}

.wide {
  width: 100%;
}
</style>
