-- Sign in with Apple.
--
-- Required by Apple guideline 4.8: an app offering a third-party social login
-- (this one offers Google) must offer an equivalent privacy-preserving login,
-- or it is rejected.
--
-- Apple identifies a user by `sub` — a stable, opaque id that is unique to
-- this app and to that Apple ID. It is stored because it is the ONLY thing a
-- returning Apple user reliably brings with them: the email address arrives
-- exactly once, on the first authorization, and never again. Matching on
-- email alone would therefore work at signup and fail at every later sign-in.
--
-- Nullable, because almost nobody has one: existing accounts, password
-- accounts and Google accounts all keep NULL here. UNIQUE so one Apple ID
-- cannot end up attached to two accounts — SQLite and Postgres both allow
-- many NULLs under a UNIQUE constraint, which is exactly the behaviour needed.
ALTER TABLE users ADD COLUMN apple_user_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_apple_user_id
  ON users (apple_user_id)
  WHERE apple_user_id IS NOT NULL;
