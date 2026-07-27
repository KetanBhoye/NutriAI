PRAGMA foreign_keys = ON;

-- Web Push subscriptions, one row per browser/device endpoint. The endpoint URL
-- is the natural primary key: re-subscribing the same device yields the same
-- endpoint, so an upsert keeps a single live row. p256dh + auth are the client
-- keys the server needs to encrypt each payload (RFC 8291).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON push_subscriptions(user_id);
