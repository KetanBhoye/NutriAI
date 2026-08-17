-- Postgres-only. Not generated from migrations/portable.
--
-- Two tables that between them decide what the AI bill looks like at scale.

-- ── Metering ─────────────────────────────────────────────────────────────
--
-- One row per model call. Exists before any quota does, deliberately: limits
-- picked without knowing the real distribution are guesses, and a guess that
-- is too tight costs users while a guess that is too loose costs money.
--
-- `cost_usd` is stored rather than derived so historical rows keep the price
-- that applied when the call happened. Rates change; a report that silently
-- restates last month's spend at this month's prices is worse than useless.
CREATE TABLE IF NOT EXISTS ai_usage (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  -- 'coach' | 'parse' | 'photo' | 'suggest' | 'weekly' | 'onboarding' | 'grounded'
  feature TEXT NOT NULL,
  model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  -- Billed separately from tokens and roughly 17x the cost of a coach turn,
  -- which is why it gets its own column rather than being folded into cost.
  grounded_queries INTEGER NOT NULL DEFAULT 0,
  cost_usd double precision NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- The quota check runs on every AI request, so it must not table-scan.
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_created ON ai_usage(user_id, created_at);
-- The global daily ceiling sums across all users.
CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_feature ON ai_usage(feature, created_at);

-- ── The shared food repository ───────────────────────────────────────────
--
-- "2 roti" is the same lookup for every user on the platform, and today each
-- one is billed separately. This is the cache that stops that, and it gets
-- better the more people use the app rather than more expensive.
--
-- Keyed on the normalised name (see utils/food-normalize.ts) so spelling and
-- spacing variants collapse onto one row.
--
-- Deliberately NOT a copy of every food anyone types. Two reasons:
--
--   Privacy — a personal library holds names like "mum's birthday cake", and a
--   global table is visible to strangers. Community entries are only promoted
--   once several unrelated people have logged the same name, which no personal
--   label survives.
--
--   Quality — one person's bad guess would otherwise become everyone's
--   default. `source` records where a row came from and reads prefer the
--   trustworthy origins first.
CREATE TABLE IF NOT EXISTS global_foods (
  normalized_key TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,

  reference_unit TEXT NOT NULL DEFAULT 'serving',
  reference_quantity double precision NOT NULL DEFAULT 1,
  calories_per_unit double precision NOT NULL,
  protein_g_per_unit double precision,
  carbs_g_per_unit double precision,
  fat_g_per_unit double precision,

  -- Highest trust first: curated < usda/openfoodfacts < grounded < community.
  source TEXT NOT NULL
    CHECK (source IN ('curated', 'usda', 'openfoodfacts', 'grounded', 'community')),
  -- How many distinct users have logged this name. Gates promotion, and is the
  -- signal that a community row is a real food rather than one person's note.
  contributor_count INTEGER NOT NULL DEFAULT 1,
  -- Times served from here instead of a paid lookup. The number that says
  -- whether this table is earning its keep.
  hit_count INTEGER NOT NULL DEFAULT 0,

  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE INDEX IF NOT EXISTS idx_global_foods_name ON global_foods(canonical_name);

-- Which users have contributed which name. This is what makes
-- `contributor_count` mean "distinct people" rather than "times logged", so
-- one enthusiastic user cannot promote their own private label.
CREATE TABLE IF NOT EXISTS global_food_contributors (
  normalized_key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY (normalized_key, user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ── Plan ─────────────────────────────────────────────────────────────────
-- Quotas are per-plan; everyone starts free.
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';
