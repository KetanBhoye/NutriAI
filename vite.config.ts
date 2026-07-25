import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  root: 'web',
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'NutriAI Tracker',
        short_name: 'NutriAI',
        description: 'Personal calorie and macro tracker',
        theme_color: '#0f1115',
        background_color: '#0f1115',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/app/',
        scope: '/app/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        navigateFallback: '/app/index.html',
        // Pull our Web Push handlers into the generated service worker. Path is
        // resolved relative to the SW's scope (/app/), and push-sw.js ships as a
        // static asset from web/public.
        importScripts: ['push-sw.js'],
        // Never serve a cached API response as if it were fresh: reads go to
        // the network first and only fall back to cache when offline, so the
        // app can open without a connection but won't show stale totals when
        // it has one.
        runtimeCaching: [
          {
            // External food lookup must never be cached. It's a live search
            // against Open Food Facts, and caching it means one slow call that
            // returns an empty 200 gets replayed as "nothing found" forever.
            urlPattern: /\/api\/foods\/lookup/,
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /\/api\/(entries|dashboard|suggestions|foods\/search)/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  base: '/app/',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./web/src', import.meta.url)),
    },
  },
  build: {
    outDir: '../public/app',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
});
