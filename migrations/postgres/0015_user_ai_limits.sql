-- Generated from migrations/portable by scripts/gen-pg-migrations.py, then
-- reviewed by hand. See migrations/postgres/README.md for what was changed
-- and why.

-- Per-user AI spend caps, set by an admin.
--
-- Plans (users.plan) cap the *number* of calls per feature, which is a proxy
-- for money and a bad one: a coach turn and a grounded lookup differ by
-- seventeen times, so two users on the same plan can cost wildly different
-- amounts. These cap the thing actually being spent.
--
-- A NULL means "no cap of this kind" rather than zero, so a row can set only a
-- monthly limit without accidentally forbidding everything daily. Both are
-- checked against real `ai_usage.cost_usd` sums, which is why metering every
-- feature had to come first — a cap over a partially-metered spend would be
-- enforcement theatre.
CREATE TABLE IF NOT EXISTS user_ai_limits (
  user_id TEXT PRIMARY KEY,
  daily_usd double precision,
  monthly_usd double precision,
  -- Why this user has a custom limit, for whoever reads the table in six
  -- months. An unexplained cap is indistinguishable from a mistake.
  note TEXT,
  updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  updated_by TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
