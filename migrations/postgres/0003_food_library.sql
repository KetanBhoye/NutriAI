-- Generated from migrations/portable by scripts/gen-pg-migrations.py, then
-- reviewed by hand. See migrations/postgres/README.md for what was changed
-- and why.

-- Personal food library: canonical foods derived from logging history,
-- the curated macros cache, and external lookups (Open Food Facts / USDA).
CREATE TABLE IF NOT EXISTS foods (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  normalized_key TEXT NOT NULL,

  -- Macros are stored per single reference unit (e.g. per 1 g, per 1 scoop,
  -- per 1 piece). Entry macros = these values * food_entries.quantity.
  reference_unit TEXT NOT NULL DEFAULT 'serving',
  reference_quantity double precision NOT NULL DEFAULT 1,
  calories_per_unit double precision NOT NULL,
  protein_g_per_unit double precision,
  carbs_g_per_unit double precision,
  fat_g_per_unit double precision,

  -- Most common quantity logged, used to pre-fill the quick-log form.
  default_quantity double precision NOT NULL DEFAULT 1,

  source TEXT NOT NULL DEFAULT 'history'
    CHECK (source IN ('history', 'curated_cache', 'openfoodfacts', 'usda', 'manual')),
  source_ref TEXT,
  verified INTEGER NOT NULL DEFAULT 0,

  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_foods_user_normalized
  ON foods(user_id, normalized_key);
CREATE INDEX IF NOT EXISTS idx_foods_user_name ON foods(user_id, canonical_name);

-- Alternate spellings that map onto a canonical food. Populated by the
-- history backfill and appended to whenever a free-text name is matched.
CREATE TABLE IF NOT EXISTS food_aliases (
  id TEXT PRIMARY KEY,
  food_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  alias_key TEXT NOT NULL,
  original_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  FOREIGN KEY (food_id) REFERENCES foods(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_food_aliases_user_key
  ON food_aliases(user_id, alias_key);
CREATE INDEX IF NOT EXISTS idx_food_aliases_food_id ON food_aliases(food_id);

-- Link existing entries to the library. Nullable throughout: food_name stays
-- the source of truth for historical rows, so an unmapped or wrongly mapped
-- entry degrades to today's behaviour rather than losing data.
ALTER TABLE food_entries ADD COLUMN food_id TEXT REFERENCES foods(id) ON DELETE SET NULL;
ALTER TABLE food_entries ADD COLUMN quantity double precision;
ALTER TABLE food_entries ADD COLUMN unit TEXT;

CREATE INDEX IF NOT EXISTS idx_food_entries_food_id ON food_entries(food_id);
CREATE INDEX IF NOT EXISTS idx_food_entries_meal_date
  ON food_entries(user_id, meal_type, entry_date);
