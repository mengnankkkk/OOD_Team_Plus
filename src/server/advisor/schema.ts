export const advisorSchema = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, display_name TEXT NOT NULL, locale TEXT NOT NULL,
    timezone TEXT NOT NULL, base_currency TEXT NOT NULL, is_demo INTEGER NOT NULL,
    demo_seed_key TEXT UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS user_profiles (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL,
    employment_status TEXT, income_stability TEXT, monthly_income_minor INTEGER,
    monthly_expense_minor INTEGER, liquid_assets_minor INTEGER, liabilities_minor INTEGER,
    emergency_fund_minor INTEGER, monthly_investable_minor INTEGER, monthly_contribution_minor INTEGER,
    near_term_cash_need_minor INTEGER,
    near_term_cash_need_date TEXT, investment_experience_years INTEGER, trade_frequency TEXT,
    subjective_risk_preference TEXT, objective_risk_capacity TEXT, effective_risk_level TEXT,
    max_acceptable_drawdown REAL, max_equity_weight REAL, max_single_position_weight REAL,
    max_sector_weight REAL, instrument_preferences_json TEXT NOT NULL, tags_json TEXT NOT NULL,
    notes TEXT, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS risk_assessments (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, questionnaire_version TEXT NOT NULL,
    subjective_risk_preference TEXT NOT NULL, objective_risk_capacity TEXT NOT NULL,
    effective_risk_level TEXT NOT NULL, subjective_score INTEGER NOT NULL, capacity_score INTEGER NOT NULL,
    max_acceptable_drawdown REAL NOT NULL, max_equity_weight REAL NOT NULL,
    max_single_position_weight REAL NOT NULL, max_sector_weight REAL NOT NULL,
    liquidity_need_level TEXT NOT NULL, conflict_detected INTEGER NOT NULL,
    conflict_summary TEXT, answers_json TEXT NOT NULL, is_current INTEGER NOT NULL,
    completed_at TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS user_goals (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, goal_type TEXT NOT NULL,
    target_amount_minor INTEGER NOT NULL, current_reserved_minor INTEGER NOT NULL,
    initial_investable_minor INTEGER NOT NULL, monthly_contribution_minor INTEGER NOT NULL,
    currency TEXT NOT NULL, target_date TEXT, horizon TEXT NOT NULL, priority INTEGER NOT NULL,
    capital_preservation_required INTEGER NOT NULL, status TEXT NOT NULL, notes TEXT,
    version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS investment_preferences (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, goal_id TEXT, scope TEXT NOT NULL,
    mode TEXT NOT NULL, rank_no INTEGER NOT NULL, label TEXT, max_weight REAL, reason TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (goal_id) REFERENCES user_goals(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, account_type TEXT NOT NULL,
    currency TEXT NOT NULL, cash_balance_minor INTEGER NOT NULL, source_type TEXT NOT NULL,
    is_demo INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS instruments (
    id TEXT PRIMARY KEY, symbol TEXT NOT NULL, name TEXT NOT NULL, instrument_type TEXT NOT NULL,
    instrument_subtype TEXT, market TEXT NOT NULL, currency TEXT NOT NULL, sector_name TEXT,
    is_tradable INTEGER NOT NULL, status TEXT NOT NULL, metadata_json TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(market, symbol)
  )`,
  `CREATE TABLE IF NOT EXISTS instrument_aliases (
    id TEXT PRIMARY KEY, instrument_id TEXT NOT NULL, alias TEXT NOT NULL,
    alias_type TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(alias, alias_type),
    FOREIGN KEY (instrument_id) REFERENCES instruments(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS holdings (
    id TEXT PRIMARY KEY, account_id TEXT NOT NULL, instrument_id TEXT NOT NULL, goal_id TEXT,
    quantity TEXT NOT NULL, average_cost TEXT NOT NULL, currency TEXT NOT NULL,
    acquired_at TEXT, purpose TEXT, planned_horizon TEXT, thesis TEXT, version INTEGER NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(account_id, instrument_id),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (instrument_id) REFERENCES instruments(id) ON DELETE RESTRICT,
    FOREIGN KEY (goal_id) REFERENCES user_goals(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS holding_lots (
    id TEXT PRIMARY KEY, holding_id TEXT NOT NULL, acquired_at TEXT, quantity TEXT NOT NULL,
    unit_cost TEXT NOT NULL, source_type TEXT NOT NULL, source_message_id TEXT,
    created_at TEXT NOT NULL, FOREIGN KEY (holding_id) REFERENCES holdings(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS holding_parse_drafts (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_id TEXT, source_text TEXT NOT NULL,
    status TEXT NOT NULL, candidates_json TEXT NOT NULL, ambiguities_json TEXT NOT NULL,
    confirmed_holding_ids_json TEXT, expires_at TEXT NOT NULL, row_version INTEGER NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS conversation_sessions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT, mode TEXT NOT NULL,
    status TEXT NOT NULL, current_intent TEXT, summary_text TEXT, last_message_at TEXT,
    waiting_for_field_code TEXT, context_json TEXT, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, sequence_no INTEGER NOT NULL, role TEXT NOT NULL,
    message_type TEXT NOT NULL, content_text TEXT, client_message_id TEXT, delivery_status TEXT NOT NULL,
    artifact_json TEXT, created_at TEXT NOT NULL, UNIQUE(session_id, sequence_no),
    UNIQUE(session_id, client_message_id),
    FOREIGN KEY (session_id) REFERENCES conversation_sessions(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS information_requests (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, analysis_id TEXT, prompt_text TEXT NOT NULL,
    fields_json TEXT NOT NULL, answers_json TEXT, status TEXT NOT NULL, blocking INTEGER NOT NULL,
    created_at TEXT NOT NULL, answered_at TEXT, expires_at TEXT,
    FOREIGN KEY (session_id) REFERENCES conversation_sessions(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, trigger_message_id TEXT, parent_run_id TEXT,
    root_run_id TEXT NOT NULL, role TEXT NOT NULL, objective TEXT NOT NULL, status TEXT NOT NULL,
    stage TEXT, input_summary TEXT, output_summary TEXT, error_code TEXT, error_message TEXT,
    started_at TEXT, completed_at TEXT, created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES conversation_sessions(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS agent_run_events (
    id TEXT PRIMARY KEY, root_run_id TEXT NOT NULL, session_id TEXT NOT NULL, sequence_no INTEGER NOT NULL,
    event_type TEXT NOT NULL, payload_json TEXT NOT NULL, occurred_at TEXT NOT NULL,
    UNIQUE(root_run_id, sequence_no),
    FOREIGN KEY (root_run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES conversation_sessions(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS tool_calls (
    id TEXT PRIMARY KEY, agent_run_id TEXT NOT NULL, tool_name TEXT NOT NULL, tool_version TEXT NOT NULL,
    status TEXT NOT NULL, arguments_json TEXT NOT NULL, result_summary TEXT, result_json TEXT,
    error_code TEXT, error_message TEXT, started_at TEXT, completed_at TEXT, created_at TEXT NOT NULL,
    FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS skill_runs (
    id TEXT PRIMARY KEY, agent_run_id TEXT NOT NULL, method_name TEXT, status TEXT NOT NULL,
    input_summary TEXT, input_json TEXT, output_summary TEXT, output_json TEXT,
    data_as_of TEXT, quality_status TEXT NOT NULL, error_code TEXT, error_message TEXT,
    started_at TEXT, completed_at TEXT, created_at TEXT NOT NULL,
    FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS evidence_items (
    id TEXT PRIMARY KEY, agent_run_id TEXT NOT NULL, kind TEXT NOT NULL, stance TEXT NOT NULL,
    quality TEXT NOT NULL, title TEXT NOT NULL, statement TEXT NOT NULL, metric_code TEXT,
    value_text TEXT, observed_at TEXT, fresh_until TEXT, confidence REAL, is_material INTEGER NOT NULL,
    created_at TEXT NOT NULL, FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS market_snapshots (
    id TEXT PRIMARY KEY, instrument_id TEXT NOT NULL, source_type TEXT NOT NULL, source_method TEXT,
    data_as_of TEXT, fresh_until TEXT, quality TEXT NOT NULL, rows INTEGER NOT NULL,
    data_json TEXT NOT NULL, metrics_json TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (instrument_id) REFERENCES instruments(id) ON DELETE RESTRICT
  )`,
  `CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, reason TEXT NOT NULL, as_of TEXT NOT NULL,
    total_value_minor INTEGER NOT NULL, cash_value_minor INTEGER NOT NULL, invested_value_minor INTEGER NOT NULL,
    total_cost_minor INTEGER NOT NULL, unrealized_pnl_minor INTEGER NOT NULL, current_drawdown REAL,
    data_quality TEXT NOT NULL, details_json TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS holding_snapshots (
    id TEXT PRIMARY KEY, portfolio_snapshot_id TEXT NOT NULL, holding_id TEXT NOT NULL,
    instrument_id TEXT NOT NULL, quantity TEXT NOT NULL, average_cost TEXT NOT NULL,
    market_price TEXT, market_value_minor INTEGER, cost_value_minor INTEGER NOT NULL,
    pnl_minor INTEGER, pnl_ratio REAL, portfolio_weight REAL, drawdown REAL, details_json TEXT NOT NULL,
    FOREIGN KEY (portfolio_snapshot_id) REFERENCES portfolio_snapshots(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS diagnostic_runs (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, analysis_id TEXT, type TEXT NOT NULL,
    status TEXT NOT NULL, portfolio_snapshot_id TEXT, details_json TEXT NOT NULL,
    created_at TEXT NOT NULL, completed_at TEXT, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS recommendations (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, analysis_id TEXT, portfolio_snapshot_id TEXT,
    instrument_id TEXT, action TEXT NOT NULL, status TEXT NOT NULL, summary TEXT NOT NULL,
    suitability TEXT NOT NULL, confidence TEXT NOT NULL, valid_until TEXT NOT NULL,
    details_json TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (instrument_id) REFERENCES instruments(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS simulations (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, recommendation_id TEXT NOT NULL, status TEXT NOT NULL,
    result_json TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (recommendation_id) REFERENCES recommendations(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS decision_logs (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_id TEXT, recommendation_id TEXT NOT NULL,
    simulation_id TEXT, action TEXT NOT NULL, reason_codes_json TEXT NOT NULL, note TEXT,
    client_request_id TEXT UNIQUE, created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (recommendation_id) REFERENCES recommendations(id) ON DELETE RESTRICT
  )`,
  `CREATE TABLE IF NOT EXISTS watch_conditions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, recommendation_id TEXT, instrument_id TEXT,
    type TEXT NOT NULL, severity TEXT NOT NULL, parameters_json TEXT NOT NULL, status TEXT NOT NULL,
    last_evaluated_at TEXT, last_triggered_at TEXT, valid_until TEXT, version INTEGER NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS watch_condition_events (
    id TEXT PRIMARY KEY, watch_condition_id TEXT NOT NULL, status TEXT NOT NULL,
    observed_value TEXT, summary TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (watch_condition_id) REFERENCES watch_conditions(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS watchlist_items (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, instrument_id TEXT NOT NULL, note TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(user_id, instrument_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (instrument_id) REFERENCES instruments(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS idempotency_records (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, operation TEXT NOT NULL, idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL, response_status INTEGER NOT NULL, response_json TEXT NOT NULL,
    created_at TEXT NOT NULL, UNIQUE(user_id, operation, idempotency_key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS demo_reset_runs (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, seed_version TEXT NOT NULL,
    status TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
] as const;
