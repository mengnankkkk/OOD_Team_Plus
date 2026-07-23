CREATE TABLE IF NOT EXISTS watchlists (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived','deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  row_version INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlists_user_name ON watchlists(user_id, name);
CREATE INDEX IF NOT EXISTS idx_watchlists_user_created ON watchlists(user_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS watchlist_items (
  id TEXT PRIMARY KEY,
  watchlist_id TEXT NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE RESTRICT,
  reason TEXT,
  planned_horizon TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')),
  added_at TEXT NOT NULL,
  removed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  row_version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_watchlist_items_watchlist_added ON watchlist_items(watchlist_id, added_at DESC);
CREATE INDEX IF NOT EXISTS idx_watchlist_items_instrument_status ON watchlist_items(instrument_id, status);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  severity TEXT NOT NULL CHECK(severity IN ('information','attention','important','urgent')),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
  body_text TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  group_key TEXT,
  read_at TEXT,
  dismissed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_group ON notifications(user_id, group_key, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'important_only' CHECK(mode IN ('important_only','daily_digest','muted')),
  quiet_hours_start TEXT,
  quiet_hours_end TEXT,
  channels_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  row_version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_notification_preferences_user_updated ON notification_preferences(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS rss_feeds (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  language TEXT NOT NULL DEFAULT 'zh',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled','error','deleted')),
  etag TEXT,
  last_modified TEXT,
  last_synced_at TEXT,
  last_error_message TEXT,
  sync_interval_minutes INTEGER NOT NULL DEFAULT 60,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  row_version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_rss_feeds_status_synced ON rss_feeds(status, last_synced_at);

CREATE TABLE IF NOT EXISTS rss_items (
  id TEXT PRIMARY KEY,
  feed_id TEXT NOT NULL REFERENCES rss_feeds(id) ON DELETE CASCADE,
  guid TEXT NOT NULL,
  title TEXT NOT NULL,
  link TEXT,
  summary TEXT,
  author TEXT,
  published_at TEXT,
  categories_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(feed_id, guid)
);

CREATE INDEX IF NOT EXISTS idx_rss_items_feed_created ON rss_items(feed_id, created_at DESC);

CREATE TABLE IF NOT EXISTS portfolio_score_snapshots (
  id TEXT PRIMARY KEY,
  portfolio_snapshot_id TEXT NOT NULL UNIQUE REFERENCES portfolio_snapshots(id) ON DELETE CASCADE,
  health_score INTEGER NOT NULL CHECK(health_score BETWEEN 0 AND 100),
  risk_score INTEGER NOT NULL CHECK(risk_score BETWEEN 0 AND 100),
  score_version TEXT NOT NULL,
  components_json TEXT NOT NULL,
  missing_metrics_json TEXT,
  computed_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_portfolio_score_snapshots_created ON portfolio_score_snapshots(score_version, created_at DESC);
