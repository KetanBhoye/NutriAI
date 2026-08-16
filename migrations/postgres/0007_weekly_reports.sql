-- Generated from migrations/portable by scripts/gen-pg-migrations.py, then
-- reviewed by hand. See migrations/postgres/README.md for what was changed
-- and why.

-- Cached AI weekly-insight reports, one row per (user, period). period_key is
-- the date the report was generated for (YYYY-MM-DD), so a user gets at most one
-- generation per day unless they force a refresh — keeps Vertex usage (and the
-- Cloud credit) in check. Old rows are harmless history.
CREATE TABLE IF NOT EXISTS weekly_reports (
  user_id TEXT NOT NULL,
  period_key TEXT NOT NULL,
  report_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY (user_id, period_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
