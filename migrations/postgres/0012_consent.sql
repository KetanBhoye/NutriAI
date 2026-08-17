
-- Recorded consent to the Terms and Privacy Policy.
--
-- A reachable policy link is enough for a store listing. It is not enough for
-- the law: health data is special-category under GDPR and sensitive under
-- India's DPDP Act, and the lawful basis for processing it is explicit
-- consent — which you have to be able to *evidence*, per person.
--
-- The version matters as much as the timestamp. Consent is to a specific text;
-- when the policy changes materially, everyone's stored version goes stale and
-- the app can ask again. Storing only a boolean would make that impossible to
-- detect, and re-prompting everyone on every wording tweak is the alternative
-- nobody wants.
ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_version TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS consented_at TEXT;
