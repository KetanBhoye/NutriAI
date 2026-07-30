export interface DailyActivity {
  activity_date: string;
  steps: number | null;
  active_energy_kcal: number | null;
  resting_energy_kcal: number | null;
  exercise_minutes: number | null;
  stand_hours: number | null;
  distance_km: number | null;
  /** What the user logged doing, e.g. "badminton". Null for health-app rows. */
  exercise_type: string | null;
  /**
   * Net energy of hand-logged exercise — the part above resting, which a
   * TDEE-based plan hasn't already counted. Kept separate from
   * `active_energy_kcal` precisely so the two are never conflated.
   */
  exercise_kcal: number | null;
  source: string;
}

export interface ActivityUpsert {
  activity_date: string;
  steps?: number | null;
  active_energy_kcal?: number | null;
  resting_energy_kcal?: number | null;
  exercise_minutes?: number | null;
  stand_hours?: number | null;
  distance_km?: number | null;
  exercise_type?: string | null;
  exercise_kcal?: number | null;
  source?: 'apple_health' | 'manual';
}

export class DailyActivityRepository {
  constructor(private db: any) {}

  /**
   * Upserts one day's activity.
   *
   * The Shortcuts automation may run several times a day (and re-run for a day
   * already recorded), so this is keyed on (user, date) and overwrites rather
   * than appending. Fields absent from the payload keep their stored value, so
   * a partial push can't wipe data an earlier one supplied.
   */
  async upsert(userId: string, activity: ActivityUpsert): Promise<void> {
    await this.db
      .prepare(
        `
        INSERT INTO daily_activity (
          id, user_id, activity_date, steps, active_energy_kcal, resting_energy_kcal,
          exercise_minutes, stand_hours, distance_km, exercise_type, exercise_kcal, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, activity_date) DO UPDATE SET
          steps = COALESCE(excluded.steps, steps),
          active_energy_kcal = COALESCE(excluded.active_energy_kcal, active_energy_kcal),
          resting_energy_kcal = COALESCE(excluded.resting_energy_kcal, resting_energy_kcal),
          exercise_minutes = COALESCE(excluded.exercise_minutes, exercise_minutes),
          stand_hours = COALESCE(excluded.stand_hours, stand_hours),
          distance_km = COALESCE(excluded.distance_km, distance_km),
          exercise_type = COALESCE(excluded.exercise_type, exercise_type),
          exercise_kcal = COALESCE(excluded.exercise_kcal, exercise_kcal),
          source = excluded.source,
          updated_at = CURRENT_TIMESTAMP
        `
      )
      .bind(
        crypto.randomUUID(),
        userId,
        activity.activity_date,
        activity.steps ?? null,
        activity.active_energy_kcal ?? null,
        activity.resting_energy_kcal ?? null,
        activity.exercise_minutes ?? null,
        activity.stand_hours ?? null,
        activity.distance_km ?? null,
        activity.exercise_type ?? null,
        activity.exercise_kcal ?? null,
        activity.source ?? 'apple_health'
      )
      .run();
  }

  async listRecent(userId: string, days = 30): Promise<DailyActivity[]> {
    const result = await this.db
      .prepare(
        `
        SELECT activity_date, steps, active_energy_kcal, resting_energy_kcal,
               exercise_minutes, stand_hours, distance_km, exercise_type, exercise_kcal, source
        FROM daily_activity
        WHERE user_id = ? AND activity_date >= date('now', ?)
        ORDER BY activity_date ASC
        `
      )
      .bind(userId, `-${days} days`)
      .all();

    return result.results as DailyActivity[];
  }
}
