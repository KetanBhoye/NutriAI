import { daysAgo } from '../db/time.js';
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
          /*
           * A health sync must not overwrite what a person typed.
           *
           * The app force-syncs Apple Health / Health Connect whenever the Plan
           * tab loads, so a hand-logged step count was posted, then immediately
           * replaced by whatever the phone had counted — and the user saw their
           * entry "not save". Manual wins for the rest of that day; they can
           * always type again, whereas a silent overwrite gives them nowhere to
           * stand.
           *
           * Only the fields a person actually sets are protected. Active
           * energy, resting energy and stand hours come from the phone alone,
           * so a sync keeps filling those in either way.
           *
           * **Steps and distance are the exception, and only ever upward.**
           *
           * Taken literally, "manual wins for the rest of that day" froze the
           * step count at whatever was stored the moment a day was first
           * touched by hand. Someone typed 1,423 in the morning and walked
           * another three thousand; the You tab read the phone directly and
           * showed 4,457, while the Plan tab — and every calorie target
           * computed from it — stayed on 1,423 until midnight. Two screens in
           * the same app disagreeing about the same day.
           *
           * The reason the original rule was too strong here is that a step
           * count is not a competing opinion about the day: it is a running
           * total, and it only goes up. A *lower* reading from the phone is
           * still the phone contradicting a person, and still loses. A higher
           * one is the same day continuing, and the person's figure is never
           * reduced by it.
           *
           * Not applied to exercise minutes or type: "45 min badminton" is a
           * description of what someone did, and the phone reporting 57
           * minutes of movement is not a better version of that sentence.
           */
          steps = CASE
            WHEN excluded.source = 'apple_health' AND daily_activity.source = 'manual'
              THEN CASE
                WHEN COALESCE(excluded.steps, -1) > COALESCE(daily_activity.steps, -1)
                  THEN excluded.steps
                ELSE daily_activity.steps END
            ELSE COALESCE(excluded.steps, daily_activity.steps) END,
          exercise_minutes = CASE
            WHEN excluded.source = 'apple_health' AND daily_activity.source = 'manual' THEN daily_activity.exercise_minutes
            ELSE COALESCE(excluded.exercise_minutes, daily_activity.exercise_minutes) END,
          exercise_type = CASE
            WHEN excluded.source = 'apple_health' AND daily_activity.source = 'manual' THEN daily_activity.exercise_type
            ELSE COALESCE(excluded.exercise_type, daily_activity.exercise_type) END,
          exercise_kcal = CASE
            WHEN excluded.source = 'apple_health' AND daily_activity.source = 'manual' THEN daily_activity.exercise_kcal
            ELSE COALESCE(excluded.exercise_kcal, daily_activity.exercise_kcal) END,
          -- Same running-total argument as steps above.
          distance_km = CASE
            WHEN excluded.source = 'apple_health' AND daily_activity.source = 'manual'
              THEN CASE
                WHEN COALESCE(excluded.distance_km, -1) > COALESCE(daily_activity.distance_km, -1)
                  THEN excluded.distance_km
                ELSE daily_activity.distance_km END
            ELSE COALESCE(excluded.distance_km, daily_activity.distance_km) END,
          active_energy_kcal = COALESCE(excluded.active_energy_kcal, daily_activity.active_energy_kcal),
          resting_energy_kcal = COALESCE(excluded.resting_energy_kcal, daily_activity.resting_energy_kcal),
          stand_hours = COALESCE(excluded.stand_hours, daily_activity.stand_hours),
          -- The day stays marked manual once a person has touched it.
          source = CASE
            WHEN excluded.source = 'apple_health' AND daily_activity.source = 'manual' THEN daily_activity.source
            ELSE excluded.source END,
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
        WHERE user_id = ? AND activity_date >= ?
        ORDER BY activity_date ASC
        `
      )
      .bind(userId, daysAgo(days))
      .all();

    return result.results as DailyActivity[];
  }
}
