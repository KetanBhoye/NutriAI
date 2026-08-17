-- Postgres-only. Not generated from migrations/portable.
--
-- Runtime settings the admin dashboard can change without a deploy.
--
-- The budget ceiling and the AI kill switch are the two controls you reach for
-- when something is going wrong *right now* — a bug calling the model in a
-- loop, or a bill climbing faster than expected. Both were environment
-- variables, which means changing either required a redeploy and several
-- minutes of continuing to spend. A table read behind a short cache costs
-- nothing and takes effect immediately.
--
-- Deliberately key/value rather than a column per setting: these are operator
-- knobs, not domain data, and a new one should not need a migration.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  -- Who moved it. When the AI is off and nobody remembers turning it off, this
  -- is the column you want.
  updated_by TEXT
);
