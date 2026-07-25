import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import './style.css';
import { initInstall } from './install';
import DashboardView from './views/DashboardView.vue';
import AuthView from './views/AuthView.vue';
import CoachView from './views/CoachView.vue';
import GoalsView from './views/GoalsView.vue';
import OnboardingView from './views/OnboardingView.vue';
import ProfileView from './views/ProfileView.vue';
import TodayView from './views/TodayView.vue';

const router = createRouter({
  history: createWebHistory('/app/'),
  routes: [
    { path: '/', name: 'today', component: TodayView },
    { path: '/dashboard', name: 'dashboard', component: DashboardView },
    { path: '/goals', name: 'goals', component: GoalsView },
    { path: '/coach', name: 'coach', component: CoachView },
    { path: '/profile', name: 'profile', component: ProfileView },
    { path: '/login', name: 'login', component: AuthView, meta: { noChrome: true } },
    { path: '/onboarding', name: 'onboarding', component: OnboardingView, meta: { noChrome: true } },
  ],
});

initInstall();
createApp(App).use(router).mount('#app');
