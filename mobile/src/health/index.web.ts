import { HealthProvider, toLocalDateString } from './types';

export * from './types';

/**
 * There is no health store in a browser.
 *
 * index.ts picks a provider by platform, and its two branches are iOS and
 * Android — on web that fell through to Health Connect and `require`d a native
 * module that cannot exist here. This file is what web resolves instead.
 *
 * It reports unavailable rather than throwing, because every caller already
 * handles unavailable: the auto-sync hook stops, and the You tab shows the
 * "synced from your phone" section (HealthSyncSection.web.tsx). A provider
 * that threw would take the whole tab layout down at import time, which is
 * how this would have failed — nowhere near the health code.
 */
export const health: HealthProvider = {
  name: 'Health',
  isAvailable: async () => false,
  availability: async () => 'unavailable',
  // Never asked (nothing calls this once isAvailable is false), but false is
  // the only honest answer: no permission can be granted for a store that
  // isn't there.
  requestPermissions: async () => false,
  hasPermissions: async () => false,
  missingPermissions: async () => [],
  getDailyHealth: async (date: Date) => ({
    date: toLocalDateString(date),
    // Null, not zero. Zero steps is a reading — a day someone didn't move —
    // and the app draws it as such. Null is "we don't know", which is the
    // truth here and the value the totals already know to ignore.
    steps: null,
    activeEnergyKcal: null,
    distanceKm: null,
    exerciseMinutes: null,
    weightKg: null,
  }),
};
