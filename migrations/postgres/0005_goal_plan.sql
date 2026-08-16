-- Generated from migrations/portable by scripts/gen-pg-migrations.py, then
-- reviewed by hand. See migrations/postgres/README.md for what was changed
-- and why.

-- The active cut/bulk plan: where you started, where you're going, by when.
--
-- Macro goals already live in user_tracking_preferences (and are editable
-- through the MCP connector). This table holds only what that can't express:
-- the weight trajectory and the activity targets it depends on.
--
-- One active plan per user; finished plans are kept with is_active = 0 so the
-- history of what was attempted survives.
CREATE TABLE IF NOT EXISTS goal_plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,

  start_weight_kg double precision NOT NULL,
  start_date DATE NOT NULL,
  goal_weight_kg double precision NOT NULL,
  target_date DATE NOT NULL,

  -- How far off the weekly target still counts as on pace, in kg. Weight
  -- fluctuates with water and gut content, so a plan without tolerance reads
  -- as failure on days that are just noise.
  tolerance_kg double precision NOT NULL DEFAULT 0.3,

  daily_step_goal INTEGER,
  weekly_training_days INTEGER,

  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_goal_plans_user_active
  ON goal_plans(user_id, is_active);
