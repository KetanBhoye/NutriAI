/** Normalised health readings, platform-agnostic. */
export interface DailyHealth {
  /** YYYY-MM-DD (local) the readings are for. */
  date: string;
  steps: number | null;
  activeEnergyKcal: number | null;
  distanceKm: number | null;
  exerciseMinutes: number | null;
  /** Most recent body-weight sample in kg (may predate `date`). */
  weightKg: number | null;
}

/**
 * Why the health store can't be used, when it can't.
 *
 * `needs-update` is distinct from `unavailable` because the advice differs and
 * getting it wrong wastes the user's time: telling someone to install Health
 * Connect when it is already installed but out of date sends them to a Play
 * Store page with an "Open" button and no explanation.
 */
export type HealthAvailability = 'available' | 'needs-update' | 'unavailable';

export interface HealthProvider {
  /** Human label for the underlying store (e.g. "Apple Health"). */
  readonly name: string;
  /** True if the health store is usable on this device. */
  isAvailable(): Promise<boolean>;
  /** Finer-grained than `isAvailable`, for a message worth reading. */
  availability?(): Promise<HealthAvailability>;
  /** Prompt for read access. Resolves true once permission is granted. */
  requestPermissions(): Promise<boolean>;
  /** Whether we already hold at least one read permission. */
  hasPermissions?(): Promise<boolean>;
  /**
   * Opens the OS health-store settings for this app.
   *
   * Needed because a request that the OS refuses to show (Android stops asking
   * after repeated denials) leaves the user with no route to grant it — the
   * message says "enable it in settings" and settings is several levels deep.
   */
  openSettings?(): Promise<void>;
  /** Read a day's aggregated metrics + latest weight. */
  getDailyHealth(date: Date): Promise<DailyHealth>;
}

export function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function dayBounds(date: Date): { start: Date; end: Date } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}
