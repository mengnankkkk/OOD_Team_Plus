ALTER TABLE agent_run_events ADD COLUMN root_run_id TEXT;
ALTER TABLE agent_run_events ADD COLUMN session_id TEXT;
ALTER TABLE agent_run_events ADD COLUMN sequence_no INTEGER;
ALTER TABLE agent_run_events ADD COLUMN occurred_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_run_events_root_sequence
  ON agent_run_events(root_run_id, sequence_no)
  WHERE root_run_id IS NOT NULL AND sequence_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_run_events_session_occurred
  ON agent_run_events(session_id, occurred_at);

CREATE TABLE IF NOT EXISTS agent_conflicts (
  id TEXT PRIMARY KEY,
  root_run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  left_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
  right_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
  conflict_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  resolution_status TEXT NOT NULL DEFAULT 'unresolved',
  resolution_text TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_conflicts_root_status
  ON agent_conflicts(root_run_id, resolution_status, created_at);
