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

export interface HealthProvider {
  /** Human label for the underlying store (e.g. "Apple Health"). */
  readonly name: string;
  /** True if the health store is usable on this device. */
  isAvailable(): Promise<boolean>;
  /** Prompt for read access. Resolves true once permission is granted. */
  requestPermissions(): Promise<boolean>;
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
