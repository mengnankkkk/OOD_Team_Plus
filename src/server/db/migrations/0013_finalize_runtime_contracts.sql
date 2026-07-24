ALTER TABLE idempotency_records ADD COLUMN response_json TEXT;
ALTER TABLE idempotency_records ADD COLUMN request_hash TEXT;

ALTER TABLE conversation_sessions ADD COLUMN title TEXT NOT NULL DEFAULT 'New conversation';
ALTER TABLE conversation_sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE conversation_sessions ADD COLUMN updated_at TEXT;
ALTER TABLE conversation_sessions ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE messages ADD COLUMN client_message_id TEXT;
ALTER TABLE messages ADD COLUMN agent_run_id TEXT;
ALTER TABLE messages ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_session_client
  ON messages(session_id, client_message_id) WHERE client_message_id IS NOT NULL;

ALTER TABLE agent_runs ADD COLUMN failure_code TEXT;
ALTER TABLE agent_runs ADD COLUMN failure_message TEXT;
ALTER TABLE agent_runs ADD COLUMN result_json TEXT;
ALTER TABLE agent_runs ADD COLUMN compliance_json TEXT;

ALTER TABLE portfolio_snapshots ADD COLUMN data_quality TEXT NOT NULL DEFAULT 'complete';
ALTER TABLE portfolio_snapshots ADD COLUMN source_statuses_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE user_profiles ADD COLUMN max_drawdown_decimal TEXT;
ALTER TABLE recommendations ADD COLUMN instrument_id TEXT;
ALTER TABLE recommendations ADD COLUMN summary TEXT;
ALTER TABLE recommendations ADD COLUMN confidence_decimal TEXT;
ALTER TABLE recommendations ADD COLUMN compliance_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE recommendations ADD COLUMN data_as_of TEXT;
ALTER TABLE recommendations ADD COLUMN provenance_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE notifications ADD COLUMN condition_id TEXT;
ALTER TABLE notifications ADD COLUMN event_id TEXT;
ALTER TABLE notifications ADD COLUMN updated_at TEXT;
ALTER TABLE notifications ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE simulation_workspaces ADD COLUMN root_branch_id TEXT;
ALTER TABLE observation_conditions ADD COLUMN last_observed_decimal TEXT;
ALTER TABLE rss_feeds ADD COLUMN etag TEXT;
ALTER TABLE rss_feeds ADD COLUMN site_url TEXT;
ALTER TABLE rss_feeds ADD COLUMN last_modified TEXT;
ALTER TABLE rss_feeds ADD COLUMN last_error_message TEXT;
ALTER TABLE rss_feeds ADD COLUMN sync_interval_minutes INTEGER NOT NULL DEFAULT 60;

ALTER TABLE generated_artifact_versions ADD COLUMN content_sha256 TEXT;
ALTER TABLE generated_artifact_versions ADD COLUMN size_bytes INTEGER;
ALTER TABLE generated_artifact_versions ADD COLUMN created_by_type TEXT NOT NULL DEFAULT 'system';
ALTER TABLE generated_artifact_versions ADD COLUMN created_by_id TEXT;
