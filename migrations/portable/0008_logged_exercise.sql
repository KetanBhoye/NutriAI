PRAGMA foreign_keys = ON;

-- Deliberate exercise the user logs by hand, as opposed to the passive
-- `active_energy_kcal` a health app pushes.
--
-- The two are kept apart on purpose. Health-app active energy is NOT added to
-- the day's expenditure, because a TDEE built from an activity level already
-- assumes normal daily movement and adding it double-counts (see
-- src/services/goal-progress.ts). A logged game or gym session is different:
-- it's the thing the activity level *didn't* anticipate, so it does count —
-- but only its net energy, which is what `exercise_kcal` stores.
ALTER TABLE daily_activity ADD COLUMN exercise_type TEXT;
ALTER TABLE daily_activity ADD COLUMN exercise_kcal INTEGER;
