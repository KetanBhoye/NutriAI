import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Unit tests for the app's logic — the pure modules and the storage-backed
 * ones, not the React tree.
 *
 * Deliberately not jest-expo/react-native-testing-library this pass: every bug
 * this app has actually shipped lived in plain functions (portion maths, the
 * PATCH payload, the write queue, the editor's gating rule), and those need no
 * renderer. Anything that touches a native module is mocked per-file, which is
 * why the environment can stay `node`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'modules/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@modules': path.resolve(__dirname, 'modules'),
    },
  },
});
