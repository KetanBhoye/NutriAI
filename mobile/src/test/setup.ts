import { beforeEach, vi } from 'vitest';

/**
 * An in-memory stand-in for AsyncStorage.
 *
 * The cache and the write queue are only meaningful *because* they persist, so
 * testing them against a fake that actually stores things is the point — a
 * mock returning undefined would pass every test while proving nothing. This
 * one keeps the same JSON-in, JSON-out contract as the real module.
 */
const store = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: async (key: string) => {
      store.delete(key);
    },
    getAllKeys: async () => [...store.keys()],
    multiRemove: async (keys: string[]) => {
      for (const k of keys) store.delete(k);
    },
  },
}));

/**
 * Native modules that can't run — or even be parsed — under Node.
 *
 * `react-native` itself ships Flow syntax that no plain bundler will read, and
 * the Expo modules expect a device. Stubbing them here rather than per-file
 * means a test can import anything under `src/` without first discovering
 * which native dependency it drags in three levels down.
 */
vi.mock('expo-secure-store', () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));

vi.mock('@react-native-cookies/cookies', () => ({
  default: {
    get: async () => ({}),
    set: async () => undefined,
    clearAll: async () => undefined,
  },
}));

vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { apiUrl: 'https://example.test' } } },
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios ?? o.default },
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
  Keyboard: { addListener: () => ({ remove: () => {} }), dismiss: () => {} },
}));

/** Exposed so a test can seed or inspect storage directly. */
export const memoryStorage = store;

beforeEach(() => {
  store.clear();
});
