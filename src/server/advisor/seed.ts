import type { AdvisorDatabase } from "@/server/advisor/database";
import { dateDaysAgo, dateYearsFromNow } from "@/server/advisor/date-utils";
import { json, nowIso, runValue, runWrite, transaction } from "@/server/advisor/store-common";

export const DEMO_USER_ID = "user_demo_01";
export const DEMO_SEED_VERSION = "demo-v4-real-sector-etf";

const instruments = [
  ["instrument_000001_sz", "000001.SZ", "平安银行", "stock", "common_stock", "cn", "银行", 1],
  ["instrument_510300_sh", "510300.SH", "沪深300ETF", "etf", "broad_index_etf", "cn", "宽基指数", 1],
  ["instrument_515000_sh", "515000.SH", "华宝中证科技龙头ETF", "etf", "sector_etf", "cn", "科技", 1],
  ["instrument_000300_sh", "000300.SH", "沪深300指数", "index", null, "cn", "宽基指数", 0],
  ["instrument_518880_sh", "518880.SH", "黄金ETF", "etf", "gold_etf", "cn", "黄金", 1],
] as const;

const aliases = [
  ["instrument_000001_sz", "平安银行"],
  ["instrument_000001_sz", "银行"],
  ["instrument_510300_sh", "沪深300"],
  ["instrument_510300_sh", "宽基"],
  ["instrument_515000_sh", "科技"],
  ["instrument_515000_sh", "科技板块"],
  ["instrument_515000_sh", "科技ETF"],
  ["instrument_518880_sh", "黄金"],
  ["instrument_518880_sh", "黄金etf"],
] as const;

export function seedAdvisorDemo(database: AdvisorDatabase, reset = false) {
  const exists = runValue<{ id: string; demo_seed_key: string | null }>(database, "SELECT id, demo_seed_key FROM users WHERE id = ?", DEMO_USER_ID);
  if (exists && !reset && exists.demo_seed_key === DEMO_SEED_VERSION) return;
  if (exists && !reset) reset = true;
  transaction(database, () => {
    if (reset) clearDemo(database);
    const timestamp = nowIso();
    runWrite(
      database,
      `INSERT OR REPLACE INTO users
       (id, display_name, locale, timezone, base_currency, is_demo, demo_seed_key, created_at, updated_at)
       VALUES (?, '演示投资者', 'zh-CN', 'Asia/Shanghai', 'CNY', 1, ?, ?, ?)`,
      DEMO_USER_ID,
      DEMO_SEED_VERSION,
      timestamp,
      timestamp,
    );
    runWrite(
      database,
      `INSERT OR REPLACE INTO user_profiles
       (id, user_id, status, income_stability, monthly_income_minor, monthly_expense_minor,
        liquid_assets_minor, emergency_fund_minor, monthly_investable_minor, monthly_contribution_minor,
        near_term_cash_need_minor, investment_experience_years, trade_frequency,
        subjective_risk_preference, objective_risk_capacity, effective_risk_level,
        max_acceptable_drawdown, max_equity_weight, max_single_position_weight, max_sector_weight,
        instrument_preferences_json, tags_json, version, created_at, updated_at)
       VALUES ('profile_demo_01', ?, 'complete', 'stable', 1800000, 900000, 20000000, 5400000,
        10000000, 300000, 3000000, 3, 'weekly', 'aggressive', 'medium', 'balanced',
        0.15, 0.65, 0.10, 0.25, ?, ?, 1, ?, ?)`,
      DEMO_USER_ID,
      json(["SECTOR_ETF", "BROAD_INDEX_ETF", "GOLD"]),
      json(["稳定收入", "关注科技", "一年内有部分流动性需求"]),
      timestamp,
      timestamp,
    );
    seedRisk(database, timestamp);
    seedGoals(database, timestamp);
    seedInstruments(database, timestamp);
    seedHoldings(database, timestamp);
    seedConversation(database, timestamp);
  });
}

function clearDemo(database: AdvisorDatabase) {
  for (const table of [
    "watch_condition_events", "watch_conditions", "watchlist_items", "decision_logs", "simulations", "recommendations",
    "diagnostic_runs", "holding_snapshots", "portfolio_snapshots", "market_snapshots", "evidence_items",
    "skill_runs", "tool_calls", "agent_run_events", "agent_runs", "information_requests", "messages",
    "conversation_sessions", "holding_parse_drafts", "holding_lots", "holdings", "accounts",
    "investment_preferences", "user_goals", "risk_assessments", "user_profiles", "users",
  ]) runWrite(database, `DELETE FROM ${table}`);
  runWrite(
    database,
    `DELETE FROM instrument_aliases
     WHERE instrument_id IN (
       SELECT id FROM instruments WHERE symbol LIKE 'DEMO%' OR id LIKE 'instrument_demo_%'
     )`,
  );
  runWrite(
    database,
    "DELETE FROM instruments WHERE symbol LIKE 'DEMO%' OR id LIKE 'instrument_demo_%'",
  );
}

function seedRisk(database: AdvisorDatabase, timestamp: string) {
  runWrite(
    database,
    `INSERT OR REPLACE INTO risk_assessments
     (id, user_id, questionnaire_version, subjective_risk_preference, objective_risk_capacity,
      effective_risk_level, subjective_score, capacity_score, max_acceptable_drawdown,
      max_equity_weight, max_single_position_weight, max_sector_weight, liquidity_need_level,
      conflict_detected, conflict_summary, answers_json, is_current, completed_at, created_at)
     VALUES ('risk_demo_01', ?, 'risk-v1', 'aggressive', 'medium', 'balanced', 76, 58,
      0.15, 0.65, 0.10, 0.25, 'medium', 1, ?, ?, 1, ?, ?)`,
    DEMO_USER_ID,
    "主观偏进取，但一年内有流动性需求，按均衡型执行。",
    json([{ questionId: "monthly_drop_10", value: "RESEARCH_FIRST" }]),
    timestamp,
    timestamp,
  );
}

function seedGoals(database: AdvisorDatabase, timestamp: string) {
  runWrite(
    database,
    `INSERT OR REPLACE INTO user_goals
     (id, user_id, name, goal_type, target_amount_minor, current_reserved_minor,
      initial_investable_minor, monthly_contribution_minor, currency, target_date, horizon,
      priority, capital_preservation_required, status, notes, version, created_at, updated_at)
      VALUES ('goal_demo_growth', ?, '三年稳健增值', 'wealth_growth', 30000000, 0,
      10000000, 300000, 'CNY', ?, 'long', 1, 0, 'active',
      '控制回撤优先于追求短期收益', 1, ?, ?)`,
      DEMO_USER_ID,
      dateYearsFromNow(3),
      timestamp,
      timestamp,
  );
}

function seedInstruments(database: AdvisorDatabase, timestamp: string) {
  for (const item of instruments) {
    runWrite(
      database,
      `INSERT OR REPLACE INTO instruments
       (id, symbol, name, instrument_type, instrument_subtype, market, currency, sector_name,
        is_tradable, status, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'CNY', ?, ?, 'active', ?, ?, ?)`,
      item[0], item[1], item[2], item[3], item[4], item[5], item[6], item[7],
      json(demoInstrumentMetadata(String(item[1]))), timestamp, timestamp,
    );
  }
  for (const [instrumentId, alias] of aliases) {
    runWrite(
      database,
      "INSERT OR IGNORE INTO instrument_aliases(id, instrument_id, alias, alias_type, created_at) VALUES (?, ?, ?, 'common_name', ?)",
      `alias_${instrumentId}_${alias}`.replace(/[^a-zA-Z0-9_]/g, "_"),
      instrumentId,
      alias.toLowerCase(),
      timestamp,
    );
  }
}

function seedHoldings(database: AdvisorDatabase, timestamp: string) {
  runWrite(
    database,
    `INSERT OR REPLACE INTO accounts
     (id, user_id, name, account_type, currency, cash_balance_minor, source_type, is_demo, created_at, updated_at)
     VALUES ('account_demo_01', ?, '演示账户', 'demo', 'CNY', 2000000, 'fixture', 1, ?, ?)`,
    DEMO_USER_ID, timestamp, timestamp,
  );
  const rows = [
    ["holding_demo_gold", "instrument_518880_sh", "10000", "4.2600", "hedge", "黄金仓位保护组合，但已偏高"],
    ["holding_demo_300", "instrument_510300_sh", "8000", "4.2000", "core", "宽基核心配置"],
    ["holding_real_bank", "instrument_000001_sz", "1000", "11.2000", "satellite", "银行股卫星仓"],
  ] as const;
  for (const row of rows) {
    runWrite(
      database,
      `INSERT OR REPLACE INTO holdings
       (id, account_id, instrument_id, goal_id, quantity, average_cost, currency, acquired_at,
        purpose, planned_horizon, thesis, version, created_at, updated_at)
      VALUES (?, 'account_demo_01', ?, 'goal_demo_growth', ?, ?, 'CNY', ?,
        ?, 'long', ?, 1, ?, ?)`,
      row[0], row[1], row[2], row[3], dateDaysAgo(95), row[4], row[5], timestamp, timestamp,
    );
  }
}

function seedConversation(database: AdvisorDatabase, timestamp: string) {
  runWrite(
    database,
    `INSERT OR REPLACE INTO conversation_sessions
     (id, user_id, title, mode, status, summary_text, last_message_at, version, created_at, updated_at)
     VALUES ('conversation_demo_gold', ?, '黄金半仓是否减仓', 'advisory', 'active',
      '用户关注黄金半仓浮盈后的加仓或减仓选择。', ?, 1, ?, ?)`,
    DEMO_USER_ID, timestamp, timestamp, timestamp,
  );
}

function demoInstrumentMetadata(symbol: string) {
  if (symbol.includes("000001")) return { price: "10.42", peTtm: "5.80", pePercentile: 0.22, macd: "BEARISH" };
  if (symbol.includes("510300")) return { price: "4.35", peTtm: "12.40", pePercentile: 0.29, macd: "NEUTRAL" };
  if (symbol.includes("000300")) return { price: "4000.00", peTtm: "12.40", pePercentile: 0.29, macd: "NEUTRAL" };
  if (symbol.includes("518880")) return { price: "5.08", peTtm: null, pePercentile: null, macd: "OVERBOUGHT" };
  return { price: "1.00" };
}
