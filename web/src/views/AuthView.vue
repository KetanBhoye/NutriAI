<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';

const router = useRouter();
const mode = ref<'login' | 'signup'>('login');
const name = ref('');
const email = ref('');
const password = ref('');
const busy = ref(false);
const error = ref<string | null>(null);

// If already signed in, skip straight into the app.
onMounted(async () => {
  try {
    const me = await api.me();
    router.replace(me.onboarded ? '/' : '/onboarding');
  } catch {
    // Not signed in — stay on the auth screen.
  }
});

async function submit(): Promise<void> {
  error.value = null;
  const mail = email.value.trim();
  if (!mail || !password.value) {
    error.value = 'Enter your email and password.';
    return;
  }
  if (mode.value === 'signup' && !name.value.trim()) {
    error.value = 'Enter your name.';
    return;
  }
  if (mode.value === 'signup' && password.value.length < 8) {
    error.value = 'Password must be at least 8 characters.';
    return;
  }

  busy.value = true;
  try {
    if (mode.value === 'login') {
      await api.login(mail, password.value);
    } else {
      await api.signup(name.value.trim(), mail, password.value);
    }
    const me = await api.me();
    router.replace(me.onboarded ? '/' : '/onboarding');
  } catch (e) {
    error.value =
      e instanceof Error && e.message && !e.message.startsWith('{')
        ? e.message
        : mode.value === 'login'
          ? 'Invalid email or password.'
          : 'Could not create the account.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="auth">
    <div class="brand">
      <div class="logo">🍎</div>
      <h1>NutriAI</h1>
      <p class="muted">{{ mode === 'login' ? 'Welcome back.' : 'Track what you eat, effortlessly.' }}</p>
    </div>

    <form class="card form" @submit.prevent="submit">
      <div v-if="mode === 'signup'" class="field">
        <label>Name</label>
        <input v-model="name" type="text" autocomplete="name" placeholder="Your name" />
      </div>

      <div class="field">
        <label>Email</label>
        <input
          v-model="email"
          type="email"
          autocomplete="email"
          autocapitalize="none"
          placeholder="you@example.com"
        />
      </div>

      <div class="field">
        <label>Password</label>
        <input
          v-model="password"
          type="password"
          :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
          placeholder="••••••••"
        />
      </div>

      <p v-if="error" class="error">{{ error }}</p>

      <button class="btn wide" type="submit" :disabled="busy">
        {{ busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account' }}
      </button>
    </form>

    <p class="switch muted">
      {{ mode === 'login' ? "New here?" : 'Already have an account?' }}
      <button
        class="link"
        type="button"
        @click="mode = mode === 'login' ? 'signup' : 'login'; error = null"
      >
        {{ mode === 'login' ? 'Create an account' : 'Sign in' }}
      </button>
    </p>
  </div>
</template>

<style scoped>
.auth {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  max-width: 420px;
  margin: 0 auto;
  padding: 24px;
}

.brand {
  text-align: center;
  margin-bottom: 24px;
}

.logo {
  font-size: 44px;
}

.brand h1 {
  font-size: 30px;
  margin: 6px 0 4px;
}

.brand .muted {
  font-size: 15px;
}

.form {
  padding: 20px;
}

.field {
  margin-bottom: 14px;
}

.field label {
  display: block;
  font-size: 13px;
  color: var(--text-dim);
  margin-bottom: 6px;
}

.wide {
  width: 100%;
  margin-top: 6px;
}

.error {
  color: var(--danger);
  font-size: 13px;
  margin: 0 0 12px;
}

.switch {
  text-align: center;
  margin-top: 18px;
  font-size: 14px;
}

.link {
  color: var(--accent);
  font-weight: 600;
  min-height: auto;
  padding: 0 2px;
}
</style>
