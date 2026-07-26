/* eslint-disable max-lines */

import { sql } from "drizzle-orm";
import { foreignKey, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username"),
    usernameNormalized: text("username_normalized"),
    passwordHash: text("password_hash"),
    displayName: text("display_name").notNull(),
    role: text("role", { enum: ["USER", "ADMIN"] }).notNull().default("USER"),
    status: text("status", { enum: ["ACTIVE", "DISABLED"] }).notNull().default("ACTIVE"),
    forcePasswordChange: integer("force_password_change", { mode: "boolean" }).notNull().default(false),
    preferredLocale: text("preferred_locale", { enum: ["zh-CN", "en-US"] }),
    passwordChangedAt: text("password_changed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at"),
    deletedAt: text("deleted_at"),
    rowVersion: integer("row_version").notNull().default(1),
  },
  (t) => [
    uniqueIndex("idx_users_username_normalized").on(t.usernameNormalized).where(sql`${t.usernameNormalized} IS NOT NULL`),
    index("idx_users_role_status").on(t.role, t.status),
  ],
);

export const apiSessions = sqliteTable(
  "api_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    csrfTokenHash: text("csrf_token_hash"),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    userAgentHash: text("user_agent_hash"),
    ipHash: text("ip_hash"),
  },
  (t) => [index("idx_api_sessions_user_expires").on(t.userId, t.expiresAt)],
);

export const userProfiles = sqliteTable("user_profiles", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  riskLevel: text("risk_level"),
  investmentAmountDecimal: text("investment_amount_decimal"),
  targetAmountDecimal: text("target_amount_decimal"),
  targetDate: text("target_date"),
  horizon: text("horizon"),
  priority: text("priority"),
  preferencesJson: text("preferences_json").notNull().default("{}"),
  maxDrawdownDecimal: text("max_drawdown_decimal"),
  status: text("status").notNull().default("draft"),
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const riskAssessments = sqliteTable("risk_assessments", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  answersJson: text("answers_json").notNull(),
  riskLevel: text("risk_level").notNull(),
  score: integer("score").notNull(),
  conflictsJson: text("conflicts_json").notNull(),
  createdAt: text("created_at").notNull(),
});

export const goals = sqliteTable("goals", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  targetAmountDecimal: text("target_amount_decimal").notNull(),
  targetDate: text("target_date"),
  horizon: text("horizon").notNull(),
  priority: text("priority").notNull(),
  assetPreference: text("asset_preference"),
  status: text("status").notNull().default("active"),
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const conversationSessions = sqliteTable(
  "conversation_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull().default("New conversation"),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at"),
    rowVersion: integer("row_version").notNull().default(1),
    titleLocale: text("title_locale").notNull().default("zh-CN"),
  },
  (t) => [index("idx_conversation_sessions_user_updated").on(t.userId, t.updatedAt)],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id"),
    role: text("role").notNull(),
    content: text("content").notNull(),
    createdAt: text("created_at").notNull(),
    clientMessageId: text("client_message_id"),
    agentRunId: text("agent_run_id"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    contentLocale: text("content_locale").notNull().default("zh-CN"),
  },
  (t) => [uniqueIndex("idx_messages_session_client").on(t.sessionId, t.clientMessageId).where(sql`${t.clientMessageId} IS NOT NULL`)],
);

export const informationRequests = sqliteTable(
  "information_requests",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    sessionId: text("session_id").notNull(),
    analysisId: text("analysis_id").notNull(),
    prompt: text("prompt").notNull(),
    fieldsJson: text("fields_json").notNull(),
    status: text("status").notNull().default("pending"),
    answersJson: text("answers_json"),
    createdAt: text("created_at").notNull(),
    answeredAt: text("answered_at"),
    expiresAt: text("expires_at"),
    contentLocale: text("content_locale").notNull().default("zh-CN"),
  },
  (t) => [index("idx_information_requests_session_status").on(t.sessionId, t.status, t.createdAt)],
);

export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    type: text("type").notNull(),
    status: text("status").notNull(),
    sessionId: text("session_id"),
    triggerMessageId: text("trigger_message_id"),
    parentRunId: text("parent_run_id"),
    rootRunId: text("root_run_id"),
    agentType: text("agent_type"),
    objective: text("objective"),
    modelProvider: text("model_provider"),
    modelName: text("model_name"),
    modelSettingsJson: text("model_settings_json"),
    inputSummary: text("input_summary"),
    outputSummary: text("output_summary"),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    latencyMs: integer("latency_ms"),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    resultJson: text("result_json"),
    complianceJson: text("compliance_json"),
    requestedLocale: text("requested_locale").notNull().default("zh-CN"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_agent_runs_session_created").on(t.sessionId, t.createdAt),
    index("idx_agent_runs_root").on(t.rootRunId),
    index("idx_agent_runs_parent").on(t.parentRunId),
  ],
);

export const agentRunEvents = sqliteTable(
  "agent_run_events",
  {
    id: text("id").primaryKey(),
    agentRunId: text("agent_run_id").notNull(),
    rootRunId: text("root_run_id"),
    sessionId: text("session_id"),
    sequenceNo: integer("sequence_no"),
    eventType: text("event_type").notNull(),
    payloadJson: text("payload_json").notNull(),
    occurredAt: text("occurred_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_agent_run_events_run_created").on(t.agentRunId, t.createdAt, t.id),
    uniqueIndex("idx_agent_run_events_root_sequence").on(t.rootRunId, t.sequenceNo),
    index("idx_agent_run_events_session_occurred").on(t.sessionId, t.occurredAt),
  ],
);

export const debateSessions = sqliteTable(
  "debate_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    conversationId: text("conversation_id").notNull().references(() => conversationSessions.id, { onDelete: "cascade" }),
    rootAgentRunId: text("root_agent_run_id").notNull(),
    motion: text("motion").notNull(),
    targetInstrumentId: text("target_instrument_id"),
    targetSymbol: text("target_symbol"),
    userDebateRole: text("user_debate_role").notNull().default("neutral"),
    status: text("status").notNull().default("active"),
    currentRoundIndex: integer("current_round_index").notNull().default(0),
    evidenceBoardId: text("evidence_board_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_debate_sessions_user_updated").on(t.userId, t.updatedAt),
    index("idx_debate_sessions_conversation").on(t.conversationId, t.updatedAt),
    index("idx_debate_sessions_root_run").on(t.rootAgentRunId),
  ],
);

export const debateRounds = sqliteTable(
  "debate_rounds",
  {
    id: text("id").primaryKey(),
    debateSessionId: text("debate_session_id").notNull().references(() => debateSessions.id, { onDelete: "cascade" }),
    roundIndex: integer("round_index").notNull(),
    roundFocus: text("round_focus").notNull(),
    userIntent: text("user_intent").notNull(),
    status: text("status").notNull().default("running"),
    judgeSummaryJson: text("judge_summary_json"),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (t) => [
    uniqueIndex("idx_debate_rounds_session_index").on(t.debateSessionId, t.roundIndex),
    uniqueIndex("idx_debate_rounds_session_id").on(t.debateSessionId, t.id),
    index("idx_debate_rounds_session_created").on(t.debateSessionId, t.createdAt),
  ],
);

export const debateTurns = sqliteTable(
  "debate_turns",
  {
    id: text("id").primaryKey(),
    debateSessionId: text("debate_session_id").notNull().references(() => debateSessions.id, { onDelete: "cascade" }),
    debateRoundId: text("debate_round_id").notNull().references(() => debateRounds.id, { onDelete: "cascade" }),
    speaker: text("speaker").notNull(),
    stance: text("stance").notNull(),
    turnType: text("turn_type").notNull(),
    content: text("content").notNull(),
    publicSummary: text("public_summary").notNull(),
    structuredPayloadJson: text("structured_payload_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    foreignKey({
      name: "fk_debate_turns_session_round",
      columns: [t.debateSessionId, t.debateRoundId],
      foreignColumns: [debateRounds.debateSessionId, debateRounds.id],
    }).onDelete("cascade"),
    index("idx_debate_turns_round_created").on(t.debateRoundId, t.createdAt, t.id),
    index("idx_debate_turns_session_created").on(t.debateSessionId, t.createdAt, t.id),
  ],
);

export const debateArguments = sqliteTable(
  "debate_arguments",
  {
    id: text("id").primaryKey(),
    debateTurnId: text("debate_turn_id").notNull(),
    stance: text("stance").notNull(),
    claim: text("claim").notNull(),
    plainLanguage: text("plain_language").notNull(),
    evidenceRefsJson: text("evidence_refs_json").notNull().default("[]"),
    counterEvidenceRefsJson: text("counter_evidence_refs_json").notNull().default("[]"),
    assumption: text("assumption").notNull(),
    confidenceDecimal: text("confidence_decimal").notNull(),
    vulnerability: text("vulnerability").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_debate_arguments_turn").on(t.debateTurnId, t.createdAt)],
);

export const debateJudgements = sqliteTable(
  "debate_judgements",
  {
    id: text("id").primaryKey(),
    debateSessionId: text("debate_session_id").notNull().references(() => debateSessions.id, { onDelete: "cascade" }),
    debateRoundId: text("debate_round_id").notNull().references(() => debateRounds.id, { onDelete: "cascade" }),
    userClaim: text("user_claim").notNull(),
    bullStrongestPoint: text("bull_strongest_point").notNull(),
    bearStrongestPoint: text("bear_strongest_point").notNull(),
    keyDisagreement: text("key_disagreement").notNull(),
    responseQualityJson: text("response_quality_json").notNull(),
    evidenceTilt: text("evidence_tilt").notNull(),
    confidenceDecimal: text("confidence_decimal").notNull(),
    whyNotFinal: text("why_not_final").notNull(),
    suggestedNextPromptsJson: text("suggested_next_prompts_json").notNull(),
    complianceNote: text("compliance_note").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    foreignKey({
      name: "fk_debate_judgements_session_round",
      columns: [t.debateSessionId, t.debateRoundId],
      foreignColumns: [debateRounds.debateSessionId, debateRounds.id],
    }).onDelete("cascade"),
    uniqueIndex("idx_debate_judgements_round").on(t.debateRoundId),
  ],
);

export const instruments = sqliteTable("instruments", {
  id: text("id").primaryKey(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  market: text("market").notNull(),
  assetType: text("asset_type").notNull(),
  sector: text("sector"),
  tradable: integer("tradable", { mode: "boolean" }).notNull().default(true),
});

export const portfolioSnapshots = sqliteTable("portfolio_snapshots", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  portfolioId: text("portfolio_id").notNull(),
  cashDecimal: text("cash_decimal").notNull().default("10000"),
  totalMarketValueDecimal: text("total_market_value_decimal").notNull().default("0"),
  dataQuality: text("data_quality").notNull().default("complete"),
  sourceStatusesJson: text("source_statuses_json").notNull().default("[]"),
  asOf: text("as_of").notNull(),
  createdAt: text("created_at").notNull(),
});

export const holdingSnapshots = sqliteTable("holding_snapshots", {
  id: text("id").primaryKey(),
  portfolioSnapshotId: text("portfolio_snapshot_id").notNull(),
  instrumentId: text("instrument_id").notNull(),
  quantityDecimal: text("quantity_decimal").notNull(),
  costDecimal: text("cost_decimal").notNull(),
  priceDecimal: text("price_decimal").notNull(),
  marketValueDecimal: text("market_value_decimal").notNull(),
  unrealizedPnlDecimal: text("unrealized_pnl_decimal").notNull().default("0"),
  weightBps: integer("weight_bps").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const holdings = sqliteTable("holdings", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  portfolioId: text("portfolio_id").notNull(),
  instrumentId: text("instrument_id").notNull(),
  quantityDecimal: text("quantity_decimal").notNull(),
  costDecimal: text("cost_decimal").notNull(),
  openedAt: text("opened_at"),
  status: text("status").notNull().default("active"),
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const recommendations = sqliteTable(
  "recommendations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    conversationId: text("conversation_id"),
    analysisId: text("analysis_id"),
    instrumentId: text("instrument_id"),
    action: text("action").notNull(),
    suitability: text("suitability").notNull(),
    summary: text("summary"),
    confidenceDecimal: text("confidence_decimal"),
    positionRangeJson: text("position_range_json").notNull(),
    firstPosition: text("first_position"),
    addConditionsJson: text("add_conditions_json").notNull(),
    referenceRangeJson: text("reference_range_json"),
    stopLoss: text("stop_loss"),
    takeProfit: text("take_profit"),
    horizon: text("horizon"),
    expiresAt: text("expires_at"),
    reasonsJson: text("reasons_json").notNull(),
    counterEvidenceJson: text("counter_evidence_json").notNull(),
    risksJson: text("risks_json").notNull(),
    alternativesJson: text("alternatives_json").notNull(),
    invalidation: text("invalidation"),
    complianceJson: text("compliance_json").notNull().default("{}"),
    dataAsOf: text("data_as_of"),
    provenanceJson: text("provenance_json").notNull().default("{}"),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    contentLocale: text("content_locale").notNull().default("zh-CN"),
  },
  (t) => [index("idx_recommendations_user_created").on(t.userId, t.createdAt)],
);

export const dataSources = sqliteTable(
  "data_sources",
  {
    id: text("id").primaryKey(),
    sourceType: text("source_type").notNull(),
    label: text("label").notNull(),
    url: text("url"),
    code: text("code"),
    name: text("name"),
    provider: text("provider"),
    version: text("version"),
    baseUrl: text("base_url"),
    licenseNote: text("license_note"),
    reliabilityLevel: text("reliability_level").notNull().default("unknown"),
    isEnabled: integer("is_enabled", { mode: "boolean" }).notNull().default(true),
    lastVerifiedAt: text("last_verified_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("idx_data_sources_code").on(t.code).where(sql`${t.code} IS NOT NULL`),
    index("idx_data_sources_type_enabled").on(t.sourceType, t.isEnabled),
  ],
);

export const evidenceItems = sqliteTable(
  "evidence_items",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    recommendationId: text("recommendation_id"),
    agentRunId: text("agent_run_id"),
    kind: text("kind").notNull(),
    stance: text("stance").notNull().default("neutral"),
    quality: text("quality").notNull().default("unknown"),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    statement: text("statement"),
    source: text("source").notNull(),
    sourceUrl: text("source_url"),
    metricCode: text("metric_code"),
    valueDecimal: text("value_decimal"),
    valueText: text("value_text"),
    unit: text("unit"),
    observedAt: text("observed_at"),
    freshUntil: text("fresh_until"),
    confidenceBps: integer("confidence_bps"),
    isMaterial: integer("is_material", { mode: "boolean" }).notNull().default(true),
    sourceLocale: text("source_locale").notNull().default("zh-CN"),
    summaryLocale: text("summary_locale").notNull().default("zh-CN"),
    translationMetadataJson: text("translation_metadata_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_evidence_run_stance").on(t.agentRunId, t.stance, t.isMaterial)],
);

export const toolCalls = sqliteTable(
  "tool_calls",
  {
    id: text("id").primaryKey(),
    agentRunId: text("agent_run_id").notNull(),
    parentToolCallId: text("parent_tool_call_id"),
    dataSourceId: text("data_source_id"),
    toolName: text("tool_name").notNull(),
    toolVersion: text("tool_version").notNull(),
    status: text("status").notNull(),
    idempotencyKey: text("idempotency_key"),
    argumentsJson: text("arguments_json").notNull(),
    resultSummary: text("result_summary"),
    resultJson: text("result_json"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    latencyMs: integer("latency_ms"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("idx_tool_calls_idempotency").on(t.idempotencyKey).where(sql`${t.idempotencyKey} IS NOT NULL`),
    index("idx_tool_calls_run_created").on(t.agentRunId, t.createdAt),
    index("idx_tool_calls_source").on(t.dataSourceId),
    index("idx_tool_calls_name_status").on(t.toolName, t.status),
  ],
);

export const skillRuns = sqliteTable(
  "skill_runs",
  {
    id: text("id").primaryKey(),
    skillAssetId: text("skill_asset_id").notNull(),
    agentRunId: text("agent_run_id").notNull(),
    toolCallId: text("tool_call_id"),
    dataSourceId: text("data_source_id"),
    methodName: text("method_name"),
    status: text("status").notNull(),
    inputSummary: text("input_summary"),
    inputJson: text("input_json"),
    outputSummary: text("output_summary"),
    outputJson: text("output_json"),
    dataAsOf: text("data_as_of"),
    freshUntil: text("fresh_until"),
    qualityStatus: text("quality_status").notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    latencyMs: integer("latency_ms"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_skill_runs_agent_created").on(t.agentRunId, t.createdAt),
    index("idx_skill_runs_asset_created").on(t.skillAssetId, t.createdAt),
    index("idx_skill_runs_source").on(t.dataSourceId),
  ],
);
