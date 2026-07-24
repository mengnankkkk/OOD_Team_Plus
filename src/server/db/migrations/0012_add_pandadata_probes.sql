CREATE TABLE IF NOT EXISTS pandadata_probes (
  id TEXT PRIMARY KEY,
  agent_run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  tool_call_id TEXT NOT NULL REFERENCES tool_calls(id) ON DELETE CASCADE,
  skill_run_id TEXT NOT NULL REFERENCES skill_runs(id) ON DELETE CASCADE,
  method_name TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('dry_run', 'live_call')),
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  duration_ms INTEGER NOT NULL,
  data_as_of TEXT,
  freshness_status TEXT,
  error_category TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pandadata_probes_run_created
  ON pandadata_probes(agent_run_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pandadata_probes_tool_phase
  ON pandadata_probes(tool_call_id, phase);
