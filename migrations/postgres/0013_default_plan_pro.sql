-- Everyone is on pro while the app is in early access.
--
-- `plan` arrived (0010) defaulting to 'free', because it was built to support
-- tiering later. Tiering does not exist yet: nothing is gated, the quota
-- ceilings are placeholders waiting on real usage data, and the people using
-- the app were invited personally. A free default meant every new signup after
-- the one-off "set everyone to pro" backfill quietly landed on a tier that was
-- never intended for them — a silent decay that only shows up when someone
-- hits a limit nobody meant to apply to them.
--
-- The default is the part worth changing: a backfill fixes the users who exist
-- today, and says nothing about the ones who sign up tomorrow. When paid tiers
-- become real, this default goes back to 'free' in a migration of its own, and
-- that will be a deliberate product decision rather than an accident of
-- column history.
ALTER TABLE users ALTER COLUMN plan SET DEFAULT 'pro';
UPDATE users SET plan = 'pro' WHERE plan <> 'pro';
