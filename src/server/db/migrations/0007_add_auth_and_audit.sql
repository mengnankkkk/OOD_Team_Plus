ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN username_normalized TEXT;
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'USER';
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE users ADD COLUMN force_password_change INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN password_changed_at TEXT;
ALTER TABLE users ADD COLUMN updated_at TEXT;
ALTER TABLE users ADD COLUMN deleted_at TEXT;
ALTER TABLE users ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX idx_users_username_normalized
  ON users(username_normalized) WHERE username_normalized IS NOT NULL;
CREATE INDEX idx_users_role_status ON users(role, status);

ALTER TABLE api_sessions ADD COLUMN csrf_token_hash TEXT;
ALTER TABLE api_sessions ADD COLUMN revoked_at TEXT;
ALTER TABLE api_sessions ADD COLUMN user_agent_hash TEXT;
ALTER TABLE api_sessions ADD COLUMN ip_hash TEXT;

CREATE TABLE auth_rate_limits (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  window_started_at TEXT NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 1,
  blocked_until TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(scope, subject_hash, window_started_at)
);

CREATE INDEX idx_auth_rate_limits_lookup
  ON auth_rate_limits(scope, subject_hash, window_started_at);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  user_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  outcome TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_audit_events_user_created
  ON audit_events(user_id, created_at DESC);
