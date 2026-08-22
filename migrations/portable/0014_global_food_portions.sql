PRAGMA foreign_keys = ON;

-- Two columns the shared food table needs before it can hold a curated
-- library rather than only cached lookups.
--
-- default_quantity: what a portion of this food usually weighs, in reference
-- units (grams, for everything seeded). Without it every curated dish would
-- default to 1 g — the personal `foods` table has carried this since 0003, and
-- its absence here is why the shared table could only ever serve exact lookups
-- and not the Add sheet.
--
-- source_ref: which row of which dataset a number came from, e.g.
-- "INDB:ASC096". Attribution obligations are per-dataset (see ATTRIBUTIONS.md),
-- and a figure that lands in someone's diary should be traceable to its
-- source — including when that source is later corrected or withdrawn.
--
-- SQLite has no ADD COLUMN IF NOT EXISTS, but migrations are recorded and run
-- once, so a plain ADD COLUMN is correct here.
ALTER TABLE global_foods ADD COLUMN default_quantity REAL NOT NULL DEFAULT 1;
ALTER TABLE global_foods ADD COLUMN source_ref TEXT;
