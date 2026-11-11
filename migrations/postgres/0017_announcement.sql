-- Postgres-only. Not generated from migrations/portable.
--
-- The first in-app announcement, seeded rather than set by hand so it is
-- already there the moment a user installs the build that can show it. The
-- admin console replaces or clears it from then on; ON CONFLICT keeps a rerun
-- from resurrecting a message an admin has since changed.
INSERT INTO app_settings (key, value, updated_by)
VALUES ('announcement', '{"id":"2026-11-11-ai-back","title":"AI features are back","body":"Coach, photo logging, meal ideas and your weekly report are working again."}', 'migration')
ON CONFLICT (key) DO NOTHING;
