import type { SqliteDb } from "./client.runtime";

export function ensureRuntimeSchema(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS api_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_api_sessions_user_expires ON api_sessions(user_id, expires_at);
    CREATE TABLE IF NOT EXISTS user_profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      risk_level TEXT,
      investment_amount_decimal TEXT,
      target_amount_decimal TEXT,
      target_date TEXT,
      horizon TEXT,
      priority TEXT,
      preferences_json TEXT NOT NULL DEFAULT '{}',
      max_drawdown_decimal TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS risk_assessments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      answers_json TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      score INTEGER NOT NULL,
      conflicts_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      target_amount_decimal TEXT NOT NULL,
      target_date TEXT,
      horizon TEXT NOT NULL,
      priority TEXT NOT NULL,
      asset_preference TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversation_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      client_message_id TEXT,
      agent_run_id TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      failure_code TEXT,
      failure_message TEXT,
      result_json TEXT,
      compliance_json TEXT
    );
    CREATE TABLE IF NOT EXISTS information_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      analysis_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      fields_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      answers_json TEXT,
      created_at TEXT NOT NULL,
      answered_at TEXT,
      expires_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_information_requests_session_status ON information_requests(session_id, status, created_at);
    CREATE TABLE IF NOT EXISTS idempotency_records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, operation, idempotency_key)
    );
    CREATE TABLE IF NOT EXISTS portfolio_snapshots (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      portfolio_id TEXT NOT NULL,
      cash_decimal TEXT NOT NULL DEFAULT '10000',
      total_market_value_decimal TEXT NOT NULL DEFAULT '0',
      data_quality TEXT NOT NULL DEFAULT 'complete',
      source_statuses_json TEXT NOT NULL DEFAULT '[]',
      as_of TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS holding_snapshots (
      id TEXT PRIMARY KEY,
      portfolio_snapshot_id TEXT NOT NULL,
      instrument_id TEXT NOT NULL,
      quantity_decimal TEXT NOT NULL,
      cost_decimal TEXT NOT NULL,
      price_decimal TEXT NOT NULL,
      market_value_decimal TEXT NOT NULL,
      unrealized_pnl_decimal TEXT NOT NULL DEFAULT '0',
      weight_bps INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS holdings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      portfolio_id TEXT NOT NULL,
      instrument_id TEXT NOT NULL,
      quantity_decimal TEXT NOT NULL,
      cost_decimal TEXT NOT NULL,
      opened_at TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS decision_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      conversation_id TEXT,
      action TEXT NOT NULL,
      recommendation_json TEXT NOT NULL,
      decision TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS instruments (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      market TEXT NOT NULL,
      asset_type TEXT NOT NULL,
      sector TEXT,
      tradable INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS data_sources (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      label TEXT NOT NULL,
      url TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS research_results (
      id TEXT PRIMARY KEY,
      search_id TEXT NOT NULL,
      adapter TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT,
      snippet TEXT NOT NULL,
      citation TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS research_searches (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      query_text TEXT NOT NULL,
      adapters_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS research_search_sources (
      id TEXT PRIMARY KEY,
      search_id TEXT NOT NULL,
      adapter TEXT NOT NULL,
      status TEXT NOT NULL,
      result_count INTEGER NOT NULL DEFAULT 0,
      error_json TEXT,
      completed_at TEXT NOT NULL,
      UNIQUE(search_id, adapter)
    );
    CREATE TABLE IF NOT EXISTS conversation_output_preferences (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      output_mode TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      row_version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS data_queries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_id TEXT,
      source_message_id TEXT,
      agent_run_id TEXT NOT NULL UNIQUE,
      question_text TEXT NOT NULL,
      account_scope_json TEXT,
      requested_datasets_json TEXT NOT NULL,
      output_mode TEXT NOT NULL,
      requested_limit INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      plan_json TEXT,
      redacted_sql TEXT,
      parameter_types_json TEXT,
      safety_checks_json TEXT,
      column_metadata_json TEXT,
      row_count INTEGER,
      result_size_bytes INTEGER,
      is_truncated INTEGER NOT NULL DEFAULT 0,
      data_as_of TEXT,
      source_summary_json TEXT,
      failure_code TEXT,
      failure_message TEXT,
      result_expires_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS data_query_result_chunks (
      id TEXT PRIMARY KEY,
      query_id TEXT NOT NULL,
      chunk_no INTEGER NOT NULL,
      first_row_no INTEGER NOT NULL,
      row_count INTEGER NOT NULL,
      rows_json TEXT NOT NULL,
      content_sha256 TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(query_id, chunk_no)
    );
    CREATE TABLE IF NOT EXISTS generated_artifacts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_id TEXT,
      source_message_id TEXT,
      source_query_id TEXT,
      agent_run_id TEXT NOT NULL,
      artifact_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'generating',
      title TEXT NOT NULL,
      current_version_no INTEGER NOT NULL DEFAULT 0,
      source_snapshot_json TEXT NOT NULL,
      source_snapshot_sha256 TEXT NOT NULL,
      provenance_json TEXT NOT NULL,
      failure_code TEXT,
      failure_message TEXT,
      ready_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      row_version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS generated_artifact_versions (
      id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL,
      version_no INTEGER NOT NULL,
      content_type TEXT NOT NULL,
      content_json TEXT,
      content_markdown TEXT,
      content_sha256 TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_by_type TEXT NOT NULL DEFAULT 'system',
      created_by_id TEXT,
      edited_by TEXT,
      edit_note TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(artifact_id, version_no)
    );
    CREATE TABLE IF NOT EXISTS message_artifacts (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      artifact_type TEXT NOT NULL,
      risk_assessment_id TEXT,
      goal_id TEXT,
      portfolio_snapshot_id TEXT,
      diagnostic_run_id TEXT,
      recommendation_id TEXT,
      simulation_id TEXT,
      generated_artifact_id TEXT,
      display_order INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      UNIQUE(message_id, artifact_type, display_order)
    );
    CREATE INDEX IF NOT EXISTS idx_message_artifacts_generated ON message_artifacts(generated_artifact_id);
    CREATE TABLE IF NOT EXISTS simulation_workspaces (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      conversation_session_id TEXT,
      recommendation_id TEXT,
      portfolio_snapshot_id TEXT NOT NULL,
      label TEXT NOT NULL,
      objective_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      root_branch_id TEXT,
      active_branch_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      row_version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS simulation_branches (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      parent_branch_id TEXT,
      parent_option_id TEXT,
      parent_simulation_id TEXT,
      label TEXT NOT NULL,
      depth INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS simulation_option_batches (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      branch_id TEXT NOT NULL,
      agent_run_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'queued',
      price_manifest_json TEXT,
      price_manifest_sha256 TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS simulation_options (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      sequence_no INTEGER NOT NULL,
      label TEXT NOT NULL,
      description_text TEXT NOT NULL,
      trades_json TEXT NOT NULL,
      analysis_json TEXT NOT NULL DEFAULT '{}',
      executed_branch_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS simulation_asset_snapshots (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      branch_id TEXT NOT NULL UNIQUE,
      portfolio_snapshot_id TEXT NOT NULL,
      base_snapshot_id TEXT,
      cash_decimal TEXT NOT NULL,
      total_market_value_decimal TEXT NOT NULL,
      metrics_json TEXT NOT NULL,
      model_version TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS simulation_asset_snapshot_items (
      id TEXT PRIMARY KEY,
      snapshot_id TEXT NOT NULL,
      instrument_id TEXT NOT NULL,
      quantity_decimal TEXT NOT NULL,
      price_decimal TEXT NOT NULL,
      market_value_decimal TEXT NOT NULL,
      weight_bps INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS simulation_branch_events (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      from_branch_id TEXT,
      to_branch_id TEXT NOT NULL,
      option_id TEXT,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS watchlists (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      row_version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS watchlist_items (
      id TEXT PRIMARY KEY,
      watchlist_id TEXT NOT NULL,
      instrument_id TEXT NOT NULL,
      reason TEXT,
      planned_horizon TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      added_at TEXT NOT NULL,
      removed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      row_version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      body_text TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT,
      group_key TEXT,
      condition_id TEXT,
      event_id TEXT,
      read_at TEXT,
      dismissed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      row_version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS notification_preferences (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      mode TEXT NOT NULL DEFAULT 'important_only',
      quiet_hours_start TEXT,
      quiet_hours_end TEXT,
      channels_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      row_version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS rss_feeds (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL UNIQUE,
      site_url TEXT,
      title TEXT NOT NULL,
      description TEXT,
      language TEXT NOT NULL DEFAULT 'zh',
      status TEXT NOT NULL DEFAULT 'active',
      last_synced_at TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      row_version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS rss_items (
      id TEXT PRIMARY KEY,
      feed_id TEXT NOT NULL,
      guid TEXT NOT NULL,
      title TEXT NOT NULL,
      link TEXT,
      summary TEXT,
      author TEXT,
      published_at TEXT,
      categories_json TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(feed_id, guid)
    );
    CREATE TABLE IF NOT EXISTS portfolio_score_snapshots (
      id TEXT PRIMARY KEY,
      portfolio_snapshot_id TEXT NOT NULL UNIQUE,
      health_score INTEGER NOT NULL,
      risk_score INTEGER NOT NULL,
      score_version TEXT NOT NULL,
      components_json TEXT NOT NULL,
      missing_metrics_json TEXT,
      computed_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_run_events (
      id TEXT PRIMARY KEY,
      agent_run_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_run_events_run_created ON agent_run_events(agent_run_id, created_at, id);
    CREATE TABLE IF NOT EXISTS recommendations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      conversation_id TEXT,
      analysis_id TEXT,
      instrument_id TEXT,
      action TEXT NOT NULL,
      suitability TEXT NOT NULL,
      summary TEXT,
      confidence_decimal TEXT,
      position_range_json TEXT NOT NULL,
      first_position TEXT,
      add_conditions_json TEXT NOT NULL,
      reference_range_json TEXT,
      stop_loss TEXT,
      take_profit TEXT,
      horizon TEXT,
      expires_at TEXT,
      reasons_json TEXT NOT NULL,
      counter_evidence_json TEXT NOT NULL,
      risks_json TEXT NOT NULL,
      alternatives_json TEXT NOT NULL,
      invalidation TEXT,
      compliance_json TEXT NOT NULL DEFAULT '{}',
      data_as_of TEXT,
      provenance_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_recommendations_user_created ON recommendations(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS evidence_items (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      recommendation_id TEXT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      source TEXT NOT NULL,
      source_url TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS observation_conditions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      holding_id TEXT,
      instrument_id TEXT,
      condition_type TEXT NOT NULL,
      threshold_decimal TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      source_recommendation_id TEXT,
      last_observed_decimal TEXT,
      last_evaluated_at TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_observation_conditions_user_status ON observation_conditions(user_id, status);
    CREATE TABLE IF NOT EXISTS observation_condition_events (
      id TEXT PRIMARY KEY,
      condition_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      observed_value TEXT NOT NULL,
      threshold_decimal TEXT NOT NULL,
      evaluation_key TEXT NOT NULL UNIQUE,
      triggered_at TEXT NOT NULL,
      reason TEXT
    );
    CREATE TABLE IF NOT EXISTS holding_parses (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      raw_text TEXT NOT NULL,
      candidates_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      confirmed_holding_ids_json TEXT,
      confirmed_at TEXT,
      row_version INTEGER NOT NULL DEFAULT 1
    );
  `);

  const columns = (table: string) => db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  const ensureColumn = (table: string, name: string, definition: string) => {
    if (!columns(table).some((column) => column.name === name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
  };
  ensureColumn("data_queries", "updated_at", "TEXT");
  db.prepare("UPDATE data_queries SET updated_at = COALESCE(updated_at, created_at) WHERE updated_at IS NULL").run();
  ensureColumn("idempotency_records", "response_json", "TEXT");
  ensureColumn("idempotency_records", "request_hash", "TEXT");
  ensureColumn("conversation_sessions", "title", "TEXT NOT NULL DEFAULT 'New conversation'");
  ensureColumn("conversation_sessions", "status", "TEXT NOT NULL DEFAULT 'active'");
  ensureColumn("conversation_sessions", "updated_at", "TEXT");
  ensureColumn("conversation_sessions", "row_version", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("messages", "client_message_id", "TEXT");
  ensureColumn("messages", "agent_run_id", "TEXT");
  ensureColumn("messages", "metadata_json", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn("agent_runs", "failure_code", "TEXT");
  ensureColumn("agent_runs", "failure_message", "TEXT");
  ensureColumn("agent_runs", "result_json", "TEXT");
  ensureColumn("agent_runs", "compliance_json", "TEXT");
  ensureColumn("portfolio_snapshots", "data_quality", "TEXT NOT NULL DEFAULT 'complete'");
  ensureColumn("portfolio_snapshots", "source_statuses_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn("user_profiles", "max_drawdown_decimal", "TEXT");
  ensureColumn("holdings", "version", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("observation_conditions", "version", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("recommendations", "instrument_id", "TEXT");
  ensureColumn("recommendations", "summary", "TEXT");
  ensureColumn("recommendations", "confidence_decimal", "TEXT");
  ensureColumn("recommendations", "compliance_json", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn("recommendations", "data_as_of", "TEXT");
  ensureColumn("recommendations", "provenance_json", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn("notifications", "condition_id", "TEXT");
  ensureColumn("notifications", "event_id", "TEXT");
  ensureColumn("notifications", "updated_at", "TEXT");
  ensureColumn("notifications", "row_version", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("simulation_workspaces", "root_branch_id", "TEXT");
  ensureColumn("observation_conditions", "last_observed_decimal", "TEXT");
  ensureColumn("holding_parses", "confirmed_holding_ids_json", "TEXT");
  ensureColumn("holding_parses", "row_version", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("rss_feeds", "etag", "TEXT");
  ensureColumn("rss_feeds", "site_url", "TEXT");
  ensureColumn("rss_feeds", "last_modified", "TEXT");
  ensureColumn("rss_feeds", "last_error_message", "TEXT");
  ensureColumn("rss_feeds", "sync_interval_minutes", "INTEGER NOT NULL DEFAULT 60");
  ensureColumn("generated_artifact_versions", "content_sha256", "TEXT");
  ensureColumn("generated_artifact_versions", "size_bytes", "INTEGER");
  ensureColumn("generated_artifact_versions", "created_by_type", "TEXT NOT NULL DEFAULT 'system'");
  ensureColumn("generated_artifact_versions", "created_by_id", "TEXT");
  ensureColumn("simulation_options", "analysis_json", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn("users", "username", "TEXT");
  ensureColumn("users", "username_normalized", "TEXT");
  ensureColumn("users", "password_hash", "TEXT");
  ensureColumn("users", "role", "TEXT NOT NULL DEFAULT 'USER'");
  ensureColumn("users", "status", "TEXT NOT NULL DEFAULT 'ACTIVE'");
  ensureColumn("users", "force_password_change", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("users", "password_changed_at", "TEXT");
  ensureColumn("users", "updated_at", "TEXT");
  ensureColumn("users", "deleted_at", "TEXT");
  ensureColumn("users", "row_version", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("api_sessions", "csrf_token_hash", "TEXT");
  ensureColumn("api_sessions", "revoked_at", "TEXT");
  ensureColumn("api_sessions", "user_agent_hash", "TEXT");
  ensureColumn("api_sessions", "ip_hash", "TEXT");
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_normalized
      ON users(username_normalized) WHERE username_normalized IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_users_role_status ON users(role, status);
    CREATE TABLE IF NOT EXISTS auth_rate_limits (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      subject_hash TEXT NOT NULL,
      window_started_at TEXT NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 1,
      blocked_until TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(scope, subject_hash, window_started_at)
    );
    CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_lookup
      ON auth_rate_limits(scope, subject_hash, window_started_at);
    CREATE TABLE IF NOT EXISTS audit_events (
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
    CREATE INDEX IF NOT EXISTS idx_audit_events_user_created
      ON audit_events(user_id, created_at DESC);
  `);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_session_client ON messages(session_id, client_message_id) WHERE client_message_id IS NOT NULL");

  const now = new Date().toISOString();
  if (process.env.NODE_ENV === "test") {
    db.prepare(`INSERT OR IGNORE INTO users
      (id,username,username_normalized,display_name,role,status,force_password_change,created_at,updated_at,row_version)
      VALUES ('demo-user','demo_user','demo_user','Test Investor','ADMIN','ACTIVE',0,?,?,1)`).run(now, now);
    db.prepare(`INSERT OR IGNORE INTO portfolio_snapshots
      (id,user_id,portfolio_id,cash_decimal,total_market_value_decimal,data_quality,source_statuses_json,as_of,created_at)
      VALUES ('portfolio-snapshot-demo','demo-user','portfolio-demo','10000','500','complete','[{"source":"TEST_FIXTURE","status":"SUCCEEDED"}]',?,?)`).run(now, now);
    db.prepare(`INSERT OR IGNORE INTO holding_snapshots
      (id,portfolio_snapshot_id,instrument_id,quantity_decimal,cost_decimal,price_decimal,market_value_decimal,unrealized_pnl_decimal,weight_bps,created_at)
      VALUES ('holding-snapshot-aapl','portfolio-snapshot-demo','AAPL','2','140','150','300','20',6000,?)`).run(now);
    db.prepare(`INSERT OR IGNORE INTO holding_snapshots
      (id,portfolio_snapshot_id,instrument_id,quantity_decimal,cost_decimal,price_decimal,market_value_decimal,unrealized_pnl_decimal,weight_bps,created_at)
      VALUES ('holding-snapshot-msft','portfolio-snapshot-demo','MSFT','1','190','200','200','10',4000,?)`).run(now);
    db.prepare(`INSERT OR IGNORE INTO holdings
      (id,user_id,portfolio_id,instrument_id,quantity_decimal,cost_decimal,status,version,created_at,updated_at)
      VALUES ('holding-demo-aapl','demo-user','portfolio-demo','AAPL','2','140','active',1,?,?)`).run(now, now);
    db.prepare(`INSERT OR IGNORE INTO holdings
      (id,user_id,portfolio_id,instrument_id,quantity_decimal,cost_decimal,status,version,created_at,updated_at)
      VALUES ('holding-demo-msft','demo-user','portfolio-demo','MSFT','1','190','active',1,?,?)`).run(now, now);
  }
  for (const instrument of [
    ["AAPL", "AAPL", "Apple", "NASDAQ", "stock", "Technology", 1],
    ["MSFT", "MSFT", "Microsoft", "NASDAQ", "stock", "Technology", 1],
    ["SPY", "SPY", "SPDR S&P 500 ETF", "NYSE", "fund", "Broad Market", 1],
    ["GLD", "GLD", "SPDR Gold Shares", "NYSE", "fund", "Commodities", 1],
    ["000300.SH", "000300.SH", "沪深300指数", "SH", "index", "Broad Market", 0],
    ["510300.SH", "510300.SH", "沪深300ETF", "SH", "fund", "Broad Market", 1],
  ]) {
    db.prepare("INSERT OR IGNORE INTO instruments (id, symbol, name, market, asset_type, sector, tradable) VALUES (?, ?, ?, ?, ?, ?, ?)").run(...instrument);
  }
}
