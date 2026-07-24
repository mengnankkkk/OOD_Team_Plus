ALTER TABLE data_sources ADD COLUMN code TEXT;
ALTER TABLE data_sources ADD COLUMN name TEXT;
ALTER TABLE data_sources ADD COLUMN provider TEXT;
ALTER TABLE data_sources ADD COLUMN version TEXT;
ALTER TABLE data_sources ADD COLUMN base_url TEXT;
ALTER TABLE data_sources ADD COLUMN license_note TEXT;
ALTER TABLE data_sources ADD COLUMN reliability_level TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE data_sources ADD COLUMN is_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE data_sources ADD COLUMN last_verified_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_data_sources_code
  ON data_sources(code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_data_sources_type_enabled
  ON data_sources(source_type, is_enabled);

ALTER TABLE agent_runs ADD COLUMN session_id TEXT;
ALTER TABLE agent_runs ADD COLUMN trigger_message_id TEXT;
ALTER TABLE agent_runs ADD COLUMN parent_run_id TEXT;
ALTER TABLE agent_runs ADD COLUMN root_run_id TEXT;
ALTER TABLE agent_runs ADD COLUMN agent_type TEXT;
ALTER TABLE agent_runs ADD COLUMN objective TEXT;
ALTER TABLE agent_runs ADD COLUMN model_provider TEXT;
ALTER TABLE agent_runs ADD COLUMN model_name TEXT;
ALTER TABLE agent_runs ADD COLUMN model_settings_json TEXT;
ALTER TABLE agent_runs ADD COLUMN input_summary TEXT;
ALTER TABLE agent_runs ADD COLUMN output_summary TEXT;
ALTER TABLE agent_runs ADD COLUMN started_at TEXT;
ALTER TABLE agent_runs ADD COLUMN latency_ms INTEGER;

CREATE INDEX IF NOT EXISTS idx_agent_runs_session_created
  ON agent_runs(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_root ON agent_runs(root_run_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_parent ON agent_runs(parent_run_id);

CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  agent_run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  parent_tool_call_id TEXT REFERENCES tool_calls(id) ON DELETE SET NULL,
  data_source_id TEXT REFERENCES data_sources(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  tool_version TEXT NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT,
  arguments_json TEXT NOT NULL,
  result_summary TEXT,
  result_json TEXT,
  error_code TEXT,
  error_message TEXT,
  started_at TEXT,
  completed_at TEXT,
  latency_ms INTEGER,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tool_calls_idempotency
  ON tool_calls(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tool_calls_run_created
  ON tool_calls(agent_run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tool_calls_source ON tool_calls(data_source_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_name_status
  ON tool_calls(tool_name, status);

CREATE TABLE IF NOT EXISTS skill_assets (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  source_repo TEXT NOT NULL,
  local_path TEXT NOT NULL,
  version TEXT NOT NULL,
  runtime TEXT NOT NULL,
  entrypoint TEXT,
  validation_level TEXT NOT NULL,
  license TEXT,
  status TEXT NOT NULL,
  input_schema_json TEXT,
  output_schema_json TEXT,
  last_smoke_test_at TEXT,
  last_smoke_test_status TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_runs (
  id TEXT PRIMARY KEY,
  skill_asset_id TEXT NOT NULL REFERENCES skill_assets(id) ON DELETE RESTRICT,
  agent_run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  tool_call_id TEXT REFERENCES tool_calls(id) ON DELETE SET NULL,
  data_source_id TEXT REFERENCES data_sources(id) ON DELETE SET NULL,
  method_name TEXT,
  status TEXT NOT NULL,
  input_summary TEXT,
  input_json TEXT,
  output_summary TEXT,
  output_json TEXT,
  data_as_of TEXT,
  fresh_until TEXT,
  quality_status TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  started_at TEXT,
  completed_at TEXT,
  latency_ms INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_skill_runs_agent_created
  ON skill_runs(agent_run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_skill_runs_asset_created
  ON skill_runs(skill_asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_skill_runs_source ON skill_runs(data_source_id);

CREATE TABLE IF NOT EXISTS market_snapshots (
  id TEXT PRIMARY KEY,
  instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE RESTRICT,
  data_source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE RESTRICT,
  snapshot_type TEXT NOT NULL,
  as_of TEXT NOT NULL,
  trading_date TEXT,
  market_timezone TEXT NOT NULL,
  freshness_status TEXT NOT NULL,
  quality_status TEXT NOT NULL,
  source_method TEXT,
  source_parameters_json TEXT,
  raw_payload_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(instrument_id, data_source_id, snapshot_type, as_of)
);

CREATE INDEX IF NOT EXISTS idx_market_snapshots_instrument_type_asof
  ON market_snapshots(instrument_id, snapshot_type, as_of DESC);
CREATE INDEX IF NOT EXISTS idx_market_snapshots_source_created
  ON market_snapshots(data_source_id, created_at DESC);

CREATE TABLE IF NOT EXISTS market_snapshot_metrics (
  id TEXT PRIMARY KEY,
  market_snapshot_id TEXT NOT NULL REFERENCES market_snapshots(id) ON DELETE CASCADE,
  metric_code TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  value_decimal TEXT,
  value_text TEXT,
  unit TEXT,
  period_code TEXT NOT NULL DEFAULT 'spot',
  comparison_basis TEXT,
  percentile_bps INTEGER,
  signal_direction TEXT,
  quality_status TEXT NOT NULL,
  formula_version TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(market_snapshot_id, metric_code, period_code),
  CHECK(value_decimal IS NOT NULL OR value_text IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_market_snapshot_metrics_code
  ON market_snapshot_metrics(metric_code);

ALTER TABLE evidence_items ADD COLUMN agent_run_id TEXT;
ALTER TABLE evidence_items ADD COLUMN stance TEXT NOT NULL DEFAULT 'neutral';
ALTER TABLE evidence_items ADD COLUMN quality TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE evidence_items ADD COLUMN statement TEXT;
ALTER TABLE evidence_items ADD COLUMN metric_code TEXT;
ALTER TABLE evidence_items ADD COLUMN value_decimal TEXT;
ALTER TABLE evidence_items ADD COLUMN value_text TEXT;
ALTER TABLE evidence_items ADD COLUMN unit TEXT;
ALTER TABLE evidence_items ADD COLUMN observed_at TEXT;
ALTER TABLE evidence_items ADD COLUMN fresh_until TEXT;
ALTER TABLE evidence_items ADD COLUMN confidence_bps INTEGER;
ALTER TABLE evidence_items ADD COLUMN is_material INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS evidence_items (
  id TEXT PRIMARY KEY,
  agent_run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  stance TEXT NOT NULL,
  quality TEXT NOT NULL,
  title TEXT NOT NULL,
  statement TEXT NOT NULL,
  metric_code TEXT,
  value_decimal TEXT,
  value_text TEXT,
  unit TEXT,
  observed_at TEXT,
  fresh_until TEXT,
  confidence_bps INTEGER,
  is_material INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_evidence_run_stance
  ON evidence_items(agent_run_id, stance, is_material);

CREATE TABLE IF NOT EXISTS evidence_source_links (
  id TEXT PRIMARY KEY,
  evidence_id TEXT NOT NULL REFERENCES evidence_items(id) ON DELETE CASCADE,
  data_source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE RESTRICT,
  tool_call_id TEXT REFERENCES tool_calls(id) ON DELETE CASCADE,
  market_snapshot_id TEXT REFERENCES market_snapshots(id) ON DELETE RESTRICT,
  market_snapshot_metric_id TEXT REFERENCES market_snapshot_metrics(id) ON DELETE RESTRICT,
  message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
  holding_snapshot_id TEXT REFERENCES holding_snapshots(id) ON DELETE RESTRICT,
  risk_assessment_id TEXT REFERENCES risk_assessments(id) ON DELETE RESTRICT,
  source_locator TEXT,
  excerpt TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_evidence_source_links_evidence
  ON evidence_source_links(evidence_id);

CREATE TABLE IF NOT EXISTS metadata_domains (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_visible INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS metadata_semantic_tables (
  id TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL REFERENCES metadata_domains(id),
  datasource_key TEXT NOT NULL,
  schema_name TEXT,
  physical_table_name TEXT NOT NULL,
  physical_description TEXT,
  semantic_name TEXT,
  semantic_description TEXT,
  is_visible INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  sync_status TEXT NOT NULL DEFAULT 'active',
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(datasource_key, schema_name, physical_table_name)
);

CREATE TABLE IF NOT EXISTS metadata_semantic_columns (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL REFERENCES metadata_semantic_tables(id),
  physical_column_name TEXT NOT NULL,
  ordinal_position INTEGER NOT NULL,
  data_type TEXT NOT NULL,
  is_nullable INTEGER NOT NULL DEFAULT 1,
  is_primary_key INTEGER NOT NULL DEFAULT 0,
  default_value TEXT,
  physical_description TEXT,
  semantic_name TEXT,
  semantic_description TEXT,
  business_type TEXT,
  example_values TEXT,
  is_visible INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  sync_status TEXT NOT NULL DEFAULT 'active',
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(table_id, physical_column_name)
);

CREATE TABLE IF NOT EXISTS metadata_logical_foreign_keys (
  id TEXT PRIMARY KEY,
  source_table_id TEXT NOT NULL REFERENCES metadata_semantic_tables(id),
  source_column_id TEXT NOT NULL REFERENCES metadata_semantic_columns(id),
  target_table_id TEXT NOT NULL REFERENCES metadata_semantic_tables(id),
  target_column_id TEXT NOT NULL REFERENCES metadata_semantic_columns(id),
  relation_type TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'manual',
  confidence REAL NOT NULL DEFAULT 1,
  physical_description TEXT,
  semantic_description TEXT,
  is_visible INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  sync_status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_column_id, target_column_id)
);

CREATE INDEX IF NOT EXISTS idx_metadata_tables_domain
  ON metadata_semantic_tables(domain_id, status, is_visible, updated_at);
CREATE INDEX IF NOT EXISTS idx_metadata_columns_table
  ON metadata_semantic_columns(table_id, status, is_visible, ordinal_position);
CREATE INDEX IF NOT EXISTS idx_metadata_fks_source
  ON metadata_logical_foreign_keys(source_table_id, status, is_visible, updated_at);

INSERT OR IGNORE INTO data_sources
  (id, source_type, label, created_at, code, name, provider, version, reliability_level, is_enabled)
VALUES
  ('source-pandadata-api', 'pandadata', 'PandaData API', CURRENT_TIMESTAMP, 'pandadata_api', 'PandaData API', 'PandaAIQuant Data Service', '0.0.12', 'primary', 1),
  ('source-pandadata-skill', 'quant_skill', 'PandaData Skill', CURRENT_TIMESTAMP, 'pandadata_skill', 'PandaData API Skill', 'QuantSkills', '0.0.12', 'derived', 1),
  ('source-local-fixture', 'local_fixture', 'Local fixture', CURRENT_TIMESTAMP, 'local_fixture', 'Local fixture', 'Money Whisperer', '1', 'secondary', 1),
  ('source-derived-engine', 'derived_engine', 'Derived engine', CURRENT_TIMESTAMP, 'derived_engine', 'Derived engine', 'Money Whisperer', '1', 'derived', 1);

INSERT OR IGNORE INTO skill_assets
  (id, slug, name, source_repo, local_path, version, runtime, entrypoint, validation_level, license, status, last_smoke_test_status, created_at, updated_at)
VALUES
  ('skill-pandadata-api', 'pandadata-api', 'PandaData API', 'quantskills/skill-pandadata-api', '.codex/skills/pandadata-api', '0.0.12', 'python', 'scripts/call_api.py', 'runnable', 'GPL-3.0-only', 'enabled', 'unknown', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
