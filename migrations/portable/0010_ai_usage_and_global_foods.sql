PRAGMA foreign_keys = ON;

-- SQLite twin of migrations/postgres/0010. See that file for why these tables
-- exist and what the promotion threshold is protecting; only the dialect
-- differs here (REAL for double precision, CURRENT_TIMESTAMP for to_char).
--
-- Production runs Postgres, so this path is exercised by the test suite and by
-- the driver-parity suite. Letting the two schemas drift would make that
-- comparison meaningless, which is the one thing keeping the Postgres port
-- honest.

CREATE TABLE IF NOT EXISTS ai_usage (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  feature TEXT NOT NULL,
  model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  grounded_queries INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_user_created ON ai_usage(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_feature ON ai_usage(feature, created_at);

CREATE TABLE IF NOT EXISTS global_foods (
  normalized_key TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  reference_unit TEXT NOT NULL DEFAULT 'serving',
  reference_quantity REAL NOT NULL DEFAULT 1,
  calories_per_unit REAL NOT NULL,
  protein_g_per_unit REAL,
  carbs_g_per_unit REAL,
  fat_g_per_unit REAL,
  source TEXT NOT NULL
    CHECK (source IN ('curated', 'usda', 'openfoodfacts', 'grounded', 'community')),
  contributor_count INTEGER NOT NULL DEFAULT 1,
  hit_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_global_foods_name ON global_foods(canonical_name);

CREATE TABLE IF NOT EXISTS global_food_contributors (
  normalized_key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (normalized_key, user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- SQLite has no ADD COLUMN IF NOT EXISTS, but migrations are recorded and run
-- once, so a plain ADD COLUMN is correct here.
ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';
