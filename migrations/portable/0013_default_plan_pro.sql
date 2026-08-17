-- Everyone is on pro while the app is in early access. See the Postgres twin
-- for the reasoning.
--
-- Only the backfill appears here. SQLite cannot alter a column default in
-- place, and rebuilding the users table to change one default would be a large
-- amount of risk for no benefit — so the signup paths set `plan` explicitly
-- instead (services/ai/quota.ts, DEFAULT_PLAN). With the value always supplied,
-- the column default is dead weight on both drivers rather than a place they
-- can quietly disagree.
UPDATE users SET plan = 'pro' WHERE plan <> 'pro';
