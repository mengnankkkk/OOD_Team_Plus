-- 0001_add_data_queries.sql
CREATE TABLE IF NOT EXISTS conversation_output_preferences (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE REFERENCES conversation_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  output_mode TEXT NOT NULL CHECK(output_mode IN ('sql_only','chart','financial_report')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  row_version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS data_queries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES conversation_sessions(id) ON DELETE SET NULL,
  source_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  agent_run_id TEXT NOT NULL UNIQUE REFERENCES agent_runs(id) ON DELETE RESTRICT,
  question_text TEXT NOT NULL CHECK(length(question_text) BETWEEN 1 AND 2000),
  account_scope_json TEXT,
  requested_datasets_json TEXT NOT NULL,
  output_mode TEXT NOT NULL CHECK(output_mode IN ('sql_only','chart','financial_report')),
  requested_limit INTEGER NOT NULL CHECK(requested_limit BETWEEN 1 AND 10000),
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','cancelled','interrupted')),
  plan_json TEXT,
  redacted_sql TEXT,
  parameter_types_json TEXT,
  safety_checks_json TEXT,
  column_metadata_json TEXT,
  row_count INTEGER,
  result_size_bytes INTEGER,
  is_truncated INTEGER NOT NULL DEFAULT 0 CHECK(is_truncated IN (0,1)),
  data_as_of TEXT,
  source_summary_json TEXT,
  failure_code TEXT,
  failure_message TEXT,
  result_expires_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  CHECK(
    status != 'succeeded' OR (
      plan_json IS NOT NULL AND redacted_sql IS NOT NULL AND
      column_metadata_json IS NOT NULL AND row_count IS NOT NULL AND completed_at IS NOT NULL
      AND failure_code IS NULL AND failure_message IS NULL
    )
  ),
  CHECK(status != 'failed' OR (failure_code IS NOT NULL AND failure_message IS NOT NULL AND completed_at IS NOT NULL)),
  CHECK(status NOT IN ('queued','running') OR completed_at IS NULL),
  CHECK(row_count IS NULL OR row_count >= 0),
  CHECK(result_size_bytes IS NULL OR result_size_bytes >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dq_agent_run ON data_queries(agent_run_id);
CREATE INDEX IF NOT EXISTS idx_dq_user_created ON data_queries(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_dq_session_created ON data_queries(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_dq_status_created ON data_queries(status, created_at);

CREATE TABLE IF NOT EXISTS data_query_result_chunks (
  id TEXT PRIMARY KEY,
  query_id TEXT NOT NULL REFERENCES data_queries(id) ON DELETE CASCADE,
  chunk_no INTEGER NOT NULL,
  first_row_no INTEGER NOT NULL,
  row_count INTEGER NOT NULL CHECK(row_count BETWEEN 1 AND 500),
  rows_json TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK(size_bytes > 0),
  created_at TEXT NOT NULL,
  UNIQUE(query_id, chunk_no),
  UNIQUE(query_id, first_row_no)
);

CREATE INDEX IF NOT EXISTS idx_dqrc_query_id ON data_query_result_chunks(query_id);
