CREATE TABLE IF NOT EXISTS debate_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  root_agent_run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  motion TEXT NOT NULL,
  target_instrument_id TEXT REFERENCES instruments(id) ON DELETE SET NULL,
  target_symbol TEXT,
  user_debate_role TEXT NOT NULL DEFAULT 'neutral',
  status TEXT NOT NULL DEFAULT 'active',
  current_round_index INTEGER NOT NULL DEFAULT 0,
  evidence_board_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_debate_sessions_user_updated
  ON debate_sessions(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_debate_sessions_conversation
  ON debate_sessions(conversation_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_debate_sessions_root_run
  ON debate_sessions(root_agent_run_id);

CREATE TABLE IF NOT EXISTS debate_rounds (
  id TEXT PRIMARY KEY,
  debate_session_id TEXT NOT NULL REFERENCES debate_sessions(id) ON DELETE CASCADE,
  round_index INTEGER NOT NULL,
  round_focus TEXT NOT NULL,
  user_intent TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  judge_summary_json TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_debate_rounds_session_index
  ON debate_rounds(debate_session_id, round_index);
CREATE INDEX IF NOT EXISTS idx_debate_rounds_session_created
  ON debate_rounds(debate_session_id, created_at);

CREATE TABLE IF NOT EXISTS debate_turns (
  id TEXT PRIMARY KEY,
  debate_session_id TEXT NOT NULL REFERENCES debate_sessions(id) ON DELETE CASCADE,
  debate_round_id TEXT NOT NULL REFERENCES debate_rounds(id) ON DELETE CASCADE,
  speaker TEXT NOT NULL,
  stance TEXT NOT NULL,
  turn_type TEXT NOT NULL,
  content TEXT NOT NULL,
  public_summary TEXT NOT NULL,
  structured_payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_debate_turns_round_created
  ON debate_turns(debate_round_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_debate_turns_session_created
  ON debate_turns(debate_session_id, created_at, id);

CREATE TABLE IF NOT EXISTS debate_arguments (
  id TEXT PRIMARY KEY,
  debate_turn_id TEXT NOT NULL REFERENCES debate_turns(id) ON DELETE CASCADE,
  stance TEXT NOT NULL,
  claim TEXT NOT NULL,
  plain_language TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  counter_evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  assumption TEXT NOT NULL,
  confidence_decimal TEXT NOT NULL,
  vulnerability TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_debate_arguments_turn
  ON debate_arguments(debate_turn_id, created_at);

CREATE TABLE IF NOT EXISTS debate_judgements (
  id TEXT PRIMARY KEY,
  debate_session_id TEXT NOT NULL REFERENCES debate_sessions(id) ON DELETE CASCADE,
  debate_round_id TEXT NOT NULL REFERENCES debate_rounds(id) ON DELETE CASCADE,
  user_claim TEXT NOT NULL,
  bull_strongest_point TEXT NOT NULL,
  bear_strongest_point TEXT NOT NULL,
  key_disagreement TEXT NOT NULL,
  response_quality_json TEXT NOT NULL,
  evidence_tilt TEXT NOT NULL,
  confidence_decimal TEXT NOT NULL,
  why_not_final TEXT NOT NULL,
  suggested_next_prompts_json TEXT NOT NULL,
  compliance_note TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_debate_judgements_round
  ON debate_judgements(debate_round_id);
