-- Generated from migrations/portable by scripts/gen-pg-migrations.py, then
-- reviewed by hand. See migrations/postgres/README.md for what was changed
-- and why.

-- Daily activity pushed in from Apple Health.
--
-- iOS gives web apps no HealthKit access, so this is populated by an Apple
-- Shortcuts automation that reads Health and POSTs to /api/activity. One row
-- per day, upserted, so re-running the automation for the same day corrects
-- the figure rather than duplicating it.
CREATE TABLE IF NOT EXISTS daily_activity (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  activity_date DATE NOT NULL,

  steps INTEGER,
  -- Active energy only. Deliberately kept separate from resting energy so the
  -- deficit calculation can choose: adding both to a TDEE that already
  -- includes resting burn would double-count it.
  active_energy_kcal double precision,
  resting_energy_kcal double precision,
  exercise_minutes INTEGER,
  stand_hours INTEGER,
  distance_km double precision,

  source TEXT NOT NULL DEFAULT 'apple_health'
    CHECK (source IN ('apple_health', 'manual')),
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_activity_user_date
  ON daily_activity(user_id, activity_date);
