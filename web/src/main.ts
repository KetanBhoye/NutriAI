import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import './style.css';
import AuthView from './views/AuthView.vue';
import AdminView from './views/AdminView.vue';

/**
 * The web app is now the admin console, and nothing else.
 *
 * It used to be a full consumer PWA — Today, Coach, Goals, Profile,
 * Onboarding — built before the native apps existed. Those screens were a
 * second implementation of everything the iOS and Android apps already do,
 * which meant every feature had to be built and tested twice, and the web copy
 * was always the one running behind. The native apps are the product now.
 *
 * What is left is the operator surface: sign in, and the dashboard. Both need
 * a browser, and neither belongs in the phone app.
 *
 * `/login` stays because the admin has to authenticate somehow, and the
 * dashboard reads the same `ct_sid` session cookie the API issues. Note the
 * OAuth/MCP connector flow does *not* depend on any of this — it uses the
 * static `public/login.html`, so removing these views cannot break a connector.
 */
const router = createRouter({
  history: createWebHistory('/app/'),
  routes: [
    { path: '/', redirect: '/admin' },
    { path: '/admin', name: 'admin', component: AdminView },
    { path: '/login', name: 'login', component: AuthView, meta: { noChrome: true } },
    // Anything else is a stale bookmark from the consumer app. Send it to the
    // dashboard rather than showing a blank screen.
    { path: '/:pathMatch(.*)*', redirect: '/admin' },
  ],
});

createApp(App).use(router).mount('#app');
