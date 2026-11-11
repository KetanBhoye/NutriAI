-- SQLite twin of migrations/postgres/0017.
INSERT INTO app_settings (key, value, updated_by)
VALUES ('announcement', '{"id":"2026-11-11-ai-back","title":"AI features are back","body":"Coach, photo logging, meal ideas and your weekly report are working again."}', 'migration')
ON CONFLICT (key) DO NOTHING;
