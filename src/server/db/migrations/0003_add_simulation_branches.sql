-- 0003_add_simulation_branches.sql
-- SQLite supports deferred foreign keys, but this migration relies on the app to create
-- workspace/branch graphs inside one transaction and to validate root/active pointers before commit.

CREATE TABLE IF NOT EXISTS simulation_workspaces (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  portfolio_snapshot_id TEXT NOT NULL REFERENCES portfolio_snapshots(id) ON DELETE RESTRICT,
  conversation_session_id TEXT REFERENCES conversation_sessions(id) ON DELETE SET NULL,
  recommendation_id TEXT REFERENCES recommendations(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 200),
  objective_text TEXT NOT NULL CHECK(length(objective_text) > 0),
  root_branch_id TEXT NOT NULL,
  active_branch_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK(row_version >= 1),
  FOREIGN KEY(id, root_branch_id) REFERENCES simulation_branches(workspace_id, id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(id, active_branch_id) REFERENCES simulation_branches(workspace_id, id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE IF NOT EXISTS simulation_branches (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES simulation_workspaces(id) ON DELETE CASCADE,
  parent_branch_id TEXT,
  parent_option_id TEXT REFERENCES simulation_options(id) ON DELETE RESTRICT,
  parent_simulation_id TEXT REFERENCES simulations(id) ON DELETE RESTRICT,
  label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 200),
  depth INTEGER NOT NULL DEFAULT 0 CHECK(depth >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived','discarded')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, id),
  CHECK((depth = 0 AND parent_branch_id IS NULL AND parent_option_id IS NULL AND parent_simulation_id IS NULL) OR (depth > 0 AND parent_branch_id IS NOT NULL AND parent_option_id IS NOT NULL AND parent_simulation_id IS NOT NULL)),
  FOREIGN KEY(workspace_id, parent_branch_id) REFERENCES simulation_branches(workspace_id, id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE IF NOT EXISTS simulation_option_batches (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES simulation_workspaces(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL,
  agent_run_id TEXT NOT NULL UNIQUE REFERENCES agent_runs(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','cancelled','interrupted')),
  price_manifest_json TEXT,
  price_manifest_sha256 TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(workspace_id, branch_id) REFERENCES simulation_branches(workspace_id, id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE IF NOT EXISTS simulation_options (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES simulation_option_batches(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES simulation_workspaces(id) ON DELETE CASCADE,
  sequence_no INTEGER NOT NULL CHECK(sequence_no >= 0),
  label TEXT NOT NULL CHECK(length(label) > 0),
  description_text TEXT NOT NULL CHECK(length(description_text) > 0),
  trades_json TEXT NOT NULL CHECK(length(trades_json) > 0),
  executed_branch_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  UNIQUE(batch_id, sequence_no),
  FOREIGN KEY(workspace_id, executed_branch_id) REFERENCES simulation_branches(workspace_id, id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE IF NOT EXISTS simulation_asset_snapshots (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES simulation_workspaces(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL UNIQUE REFERENCES simulation_branches(id) ON DELETE RESTRICT,
  portfolio_snapshot_id TEXT NOT NULL REFERENCES portfolio_snapshots(id) ON DELETE RESTRICT,
  base_snapshot_id TEXT REFERENCES simulation_asset_snapshots(id) ON DELETE RESTRICT,
  cash_decimal TEXT NOT NULL,
  total_market_value_decimal TEXT NOT NULL,
  metrics_json TEXT NOT NULL CHECK(length(metrics_json) > 0),
  model_version TEXT NOT NULL CHECK(length(model_version) > 0),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS simulation_asset_snapshot_items (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES simulation_asset_snapshots(id) ON DELETE CASCADE,
  instrument_id TEXT NOT NULL,
  quantity_decimal TEXT NOT NULL,
  price_decimal TEXT NOT NULL,
  market_value_decimal TEXT NOT NULL,
  weight_bps INTEGER NOT NULL CHECK(weight_bps BETWEEN 0 AND 10000),
  created_at TEXT NOT NULL,
  UNIQUE(snapshot_id, instrument_id)
);

CREATE TABLE IF NOT EXISTS simulation_branch_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES simulation_workspaces(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK(event_type IN ('root_created','option_executed','branch_switched','undo')),
  from_branch_id TEXT,
  to_branch_id TEXT NOT NULL REFERENCES simulation_branches(id) ON DELETE RESTRICT,
  option_id TEXT REFERENCES simulation_options(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(workspace_id, from_branch_id) REFERENCES simulation_branches(workspace_id, id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(workspace_id, to_branch_id) REFERENCES simulation_branches(workspace_id, id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_sw_user_status_updated ON simulation_workspaces(user_id, status, updated_at, id);
CREATE INDEX IF NOT EXISTS idx_sw_session ON simulation_workspaces(conversation_session_id);
CREATE INDEX IF NOT EXISTS idx_sw_recommendation ON simulation_workspaces(recommendation_id);

CREATE INDEX IF NOT EXISTS idx_sb_workspace_parent_created ON simulation_branches(workspace_id, parent_branch_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_sb_parent_option ON simulation_branches(parent_option_id);
CREATE INDEX IF NOT EXISTS idx_sb_parent_simulation ON simulation_branches(parent_simulation_id);

CREATE INDEX IF NOT EXISTS idx_sob_workspace_branch_created ON simulation_option_batches(workspace_id, branch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sob_status ON simulation_option_batches(status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_so_batch_sequence ON simulation_options(batch_id, sequence_no);
CREATE UNIQUE INDEX IF NOT EXISTS uq_so_executed_branch ON simulation_options(executed_branch_id);
CREATE INDEX IF NOT EXISTS idx_so_batch_created ON simulation_options(batch_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sas_branch ON simulation_asset_snapshots(branch_id);
CREATE INDEX IF NOT EXISTS idx_sas_workspace_created ON simulation_asset_snapshots(workspace_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sasi_snapshot_instrument ON simulation_asset_snapshot_items(snapshot_id, instrument_id);
CREATE INDEX IF NOT EXISTS idx_sasi_instrument ON simulation_asset_snapshot_items(instrument_id);

CREATE INDEX IF NOT EXISTS idx_sbe_workspace_created ON simulation_branch_events(workspace_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_sbe_to_branch ON simulation_branch_events(to_branch_id);
CREATE INDEX IF NOT EXISTS idx_sbe_from_branch ON simulation_branch_events(from_branch_id);
