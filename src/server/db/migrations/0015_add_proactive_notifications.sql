ALTER TABLE notifications ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE notifications ADD COLUMN data_as_of TEXT;
ALTER TABLE notifications ADD COLUMN expires_at TEXT;
ALTER TABLE notifications ADD COLUMN dedupe_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe_key
  ON notifications(dedupe_key)
  WHERE dedupe_key IS NOT NULL;

ALTER TABLE watchlist_items ADD COLUMN drawdown_threshold_bps INTEGER;

CREATE TABLE IF NOT EXISTS notification_sync_states (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'idle' CHECK(status IN ('idle','running','succeeded','partial','failed')),
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_market_refresh_at TEXT,
  data_as_of TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notification_sync_states_status
  ON notification_sync_states(status, updated_at DESC);
