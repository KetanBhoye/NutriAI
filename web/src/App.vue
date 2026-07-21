<script setup lang="ts">
import { isOnline, pendingCount } from './api';
</script>

<template>
  <div>
    <Transition name="fade">
      <div v-if="!isOnline || pendingCount > 0" class="banner">
        <span v-if="!isOnline">
          Offline — {{ pendingCount }} {{ pendingCount === 1 ? 'entry' : 'entries' }} saved on this
          device, syncing when you're back.
        </span>
        <span v-else>Syncing {{ pendingCount }}…</span>
      </div>
    </Transition>

    <RouterView v-slot="{ Component }">
      <Transition name="fade" mode="out-in">
        <component :is="Component" />
      </Transition>
    </RouterView>

    <nav class="tabbar">
      <RouterLink to="/" class="tab">Today</RouterLink>
      <RouterLink to="/coach" class="tab">Coach</RouterLink>
      <RouterLink to="/dashboard" class="tab">Trends</RouterLink>
      <RouterLink to="/goals" class="tab">Plan</RouterLink>
    </nav>
  </div>
</template>

<style scoped>
.banner {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--warn);
  color: #241a00;
  font-size: 14px;
  font-weight: 500;
  padding: 10px 16px;
  padding-top: calc(10px + env(safe-area-inset-top));
  text-align: center;
}

.tabbar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  background: rgba(23, 26, 33, 0.94);
  backdrop-filter: blur(12px);
  border-top: 1px solid var(--border);
  padding-bottom: env(safe-area-inset-bottom);
}

.tab {
  flex: 1;
  text-align: center;
  padding: 14px 0;
  min-height: var(--tap);
  color: var(--text-dim);
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
}

.tab.router-link-exact-active {
  color: var(--accent);
}
</style>
