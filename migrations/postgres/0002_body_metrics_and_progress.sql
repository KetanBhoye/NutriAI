-- Generated from migrations/portable by scripts/gen-pg-migrations.py, then
-- reviewed by hand. See migrations/postgres/README.md for what was changed
-- and why.

CREATE TABLE IF NOT EXISTS body_measurements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  recorded_date DATE NOT NULL DEFAULT CURRENT_DATE,
  source_app TEXT,
  source_image_url TEXT,
  source_image_ref TEXT,
  body_weight_kg double precision,
  body_mass_index double precision,
  body_fat_ratio_pct double precision,
  muscle_rate_pct double precision,
  body_water_pct double precision,
  bone_mass_kg double precision,
  basal_metabolic_rate_kcal double precision,
  metabolic_age_years INTEGER,
  visceral_fat_pct double precision,
  subcutaneous_fat_pct double precision,
  protein_mass_kg double precision,
  muscle_mass_kg double precision,
  weight_without_fat_kg double precision,
  obesity_level TEXT,
  notes TEXT,
  raw_payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_body_measurements_user_date ON body_measurements(user_id, recorded_date);
CREATE INDEX IF NOT EXISTS idx_body_measurements_created_at ON body_measurements(created_at);

CREATE TABLE IF NOT EXISTS progress_photos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  recorded_date DATE NOT NULL DEFAULT CURRENT_DATE,
  pose_type TEXT NOT NULL CHECK (pose_type IN ('front', 'back', 'left_side', 'right_side', 'other')),
  image_url TEXT,
  image_ref TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_progress_photos_user_date ON progress_photos(user_id, recorded_date);
CREATE INDEX IF NOT EXISTS idx_progress_photos_pose ON progress_photos(user_id, pose_type, recorded_date);

CREATE TABLE IF NOT EXISTS user_tracking_preferences (
  user_id TEXT PRIMARY KEY,
  display_name TEXT,
  daily_calorie_goal INTEGER,
  daily_protein_goal_g double precision,
  daily_carbs_goal_g double precision,
  daily_fat_goal_g double precision,
  behavior_instructions TEXT,
  macros_cache_notes TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
