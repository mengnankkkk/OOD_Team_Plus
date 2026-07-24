CREATE TABLE IF NOT EXISTS information_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES conversation_sessions(id) ON DELETE CASCADE,
  analysis_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL CHECK(length(prompt) BETWEEN 1 AND 2000),
  fields_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','answered','expired')),
  answers_json TEXT,
  created_at TEXT NOT NULL,
  answered_at TEXT,
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_information_requests_session_status
  ON information_requests(session_id, status, created_at);
