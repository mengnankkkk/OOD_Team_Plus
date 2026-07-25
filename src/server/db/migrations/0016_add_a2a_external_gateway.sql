CREATE TABLE a2a_external_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','DISABLED')),
  capabilities_json TEXT NOT NULL,
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 60 CHECK(rate_limit_per_minute BETWEEN 1 AND 10000),
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_used_at TEXT,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version >= 1)
);

CREATE TABLE a2a_external_client_tokens (
  id TEXT PRIMARY KEY,
  external_client_id TEXT NOT NULL REFERENCES a2a_external_clients(id) ON DELETE CASCADE,
  token_prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE TABLE a2a_contexts (
  id TEXT PRIMARY KEY,
  external_client_id TEXT NOT NULL REFERENCES a2a_external_clients(id) ON DELETE CASCADE,
  execution_user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  primary_capability TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','COMPLETED','ARCHIVED','EXPIRED')),
  profile_json TEXT NOT NULL DEFAULT '{}',
  goals_json TEXT NOT NULL DEFAULT '[]',
  portfolio_input_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE a2a_tasks (
  id TEXT PRIMARY KEY,
  external_client_id TEXT NOT NULL REFERENCES a2a_external_clients(id) ON DELETE CASCADE,
  context_id TEXT NOT NULL REFERENCES a2a_contexts(id) ON DELETE CASCADE,
  capability_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  client_message_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('submitted','working','input-required','completed','canceled','failed')),
  domain_resource_type TEXT,
  domain_resource_id TEXT,
  input_json TEXT NOT NULL,
  result_json TEXT,
  error_json TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  expires_at TEXT NOT NULL,
  UNIQUE(external_client_id, client_message_id)
);

CREATE TABLE a2a_task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES a2a_tasks(id) ON DELETE CASCADE,
  sequence_no INTEGER NOT NULL CHECK(sequence_no >= 1),
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(task_id, sequence_no)
);

CREATE TABLE a2a_debate_sessions (
  id TEXT PRIMARY KEY,
  context_id TEXT NOT NULL UNIQUE REFERENCES a2a_contexts(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','FINALIZED','ARCHIVED')),
  current_round_no INTEGER NOT NULL DEFAULT 0 CHECK(current_round_no >= 0),
  evidence_board_json TEXT NOT NULL DEFAULT '{}',
  final_task_id TEXT REFERENCES a2a_tasks(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE a2a_debate_rounds (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES a2a_debate_sessions(id) ON DELETE CASCADE,
  round_no INTEGER NOT NULL CHECK(round_no >= 1),
  operation TEXT NOT NULL,
  focus TEXT NOT NULL,
  user_stance TEXT CHECK(user_stance IN ('NEUTRAL','BULL','BEAR')),
  judge_result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  UNIQUE(session_id, round_no)
);

CREATE TABLE a2a_debate_turns (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES a2a_debate_rounds(id) ON DELETE CASCADE,
  sequence_no INTEGER NOT NULL CHECK(sequence_no >= 1),
  role TEXT NOT NULL CHECK(role IN ('USER','ORCHESTRATOR','EVIDENCE','BULL','BEAR','JUDGE')),
  content TEXT NOT NULL,
  structured_output_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(round_id, sequence_no)
);

CREATE INDEX idx_a2a_clients_status
  ON a2a_external_clients(status, created_at DESC);
CREATE INDEX idx_a2a_tokens_client_active
  ON a2a_external_client_tokens(external_client_id, revoked_at);
CREATE INDEX idx_a2a_contexts_client_expiry
  ON a2a_contexts(external_client_id, expires_at);
CREATE INDEX idx_a2a_tasks_client_created
  ON a2a_tasks(external_client_id, created_at DESC, id DESC);
CREATE INDEX idx_a2a_tasks_context_created
  ON a2a_tasks(context_id, created_at, id);
CREATE INDEX idx_a2a_tasks_status
  ON a2a_tasks(status, created_at);
