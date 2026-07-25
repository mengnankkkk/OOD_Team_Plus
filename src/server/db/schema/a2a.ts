import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { users } from "./core";

export const a2aExternalClients = sqliteTable(
  "a2a_external_clients",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    status: text("status", { enum: ["ACTIVE", "DISABLED"] as const }).notNull().default("ACTIVE"),
    capabilitiesJson: text("capabilities_json").notNull(),
    rateLimitPerMinute: integer("rate_limit_per_minute").notNull().default(60),
    createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    lastUsedAt: text("last_used_at"),
    rowVersion: integer("row_version").notNull().default(1),
  },
  (t) => [
    check("chk_a2a_clients_name_length", sql`length(${t.name}) BETWEEN 1 AND 200`),
    check("chk_a2a_clients_status", sql`${t.status} IN ('ACTIVE','DISABLED')`),
    check("chk_a2a_clients_rate_limit", sql`${t.rateLimitPerMinute} BETWEEN 1 AND 10000`),
    check("chk_a2a_clients_row_version", sql`${t.rowVersion} >= 1`),
    index("idx_a2a_clients_status").on(t.status, sql`${t.createdAt} DESC`),
  ],
);

export const a2aExternalClientTokens = sqliteTable(
  "a2a_external_client_tokens",
  {
    id: text("id").primaryKey(),
    externalClientId: text("external_client_id").notNull().references(() => a2aExternalClients.id, { onDelete: "cascade" }),
    tokenPrefix: text("token_prefix").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdAt: text("created_at").notNull(),
    lastUsedAt: text("last_used_at"),
    revokedAt: text("revoked_at"),
  },
  (t) => [
    uniqueIndex("uq_a2a_tokens_hash").on(t.tokenHash),
    index("idx_a2a_tokens_client_active").on(t.externalClientId, t.revokedAt),
  ],
);

export const a2aContexts = sqliteTable(
  "a2a_contexts",
  {
    id: text("id").primaryKey(),
    externalClientId: text("external_client_id").notNull().references(() => a2aExternalClients.id, { onDelete: "cascade" }),
    executionUserId: text("execution_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    primaryCapability: text("primary_capability").notNull(),
    status: text("status", { enum: ["ACTIVE", "COMPLETED", "ARCHIVED", "EXPIRED"] as const }).notNull().default("ACTIVE"),
    profileJson: text("profile_json").notNull().default("{}"),
    goalsJson: text("goals_json").notNull().default("[]"),
    portfolioInputJson: text("portfolio_input_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [
    uniqueIndex("uq_a2a_contexts_id_client").on(t.id, t.externalClientId),
    uniqueIndex("uq_a2a_contexts_execution_user").on(t.executionUserId),
    check("chk_a2a_contexts_status", sql`${t.status} IN ('ACTIVE','COMPLETED','ARCHIVED','EXPIRED')`),
    index("idx_a2a_contexts_client_expiry").on(t.externalClientId, t.expiresAt),
  ],
);

export const a2aTasks = sqliteTable(
  "a2a_tasks",
  {
    id: text("id").primaryKey(),
    externalClientId: text("external_client_id").notNull().references(() => a2aExternalClients.id, { onDelete: "cascade" }),
    contextId: text("context_id").notNull(),
    capabilityId: text("capability_id").notNull(),
    operation: text("operation").notNull(),
    clientMessageId: text("client_message_id").notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status", {
      enum: ["submitted", "working", "input-required", "completed", "canceled", "failed"] as const,
    }).notNull(),
    domainResourceType: text("domain_resource_type"),
    domainResourceId: text("domain_resource_id"),
    inputJson: text("input_json").notNull(),
    resultJson: text("result_json"),
    errorJson: text("error_json"),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    cancelledAt: text("cancelled_at"),
    expiresAt: text("expires_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_a2a_tasks_client_message").on(t.externalClientId, t.clientMessageId),
    foreignKey({
      columns: [t.contextId, t.externalClientId],
      foreignColumns: [a2aContexts.id, a2aContexts.externalClientId],
      name: "fk_a2a_tasks_context_client",
    }).onDelete("cascade"),
    check("chk_a2a_tasks_status", sql`${t.status} IN ('submitted','working','input-required','completed','canceled','failed')`),
    index("idx_a2a_tasks_client_created").on(t.externalClientId, sql`${t.createdAt} DESC`, sql`${t.id} DESC`),
    index("idx_a2a_tasks_context_created").on(t.contextId, t.createdAt, t.id),
    index("idx_a2a_tasks_status").on(t.status, t.createdAt),
  ],
);

export const a2aTaskEvents = sqliteTable(
  "a2a_task_events",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull().references(() => a2aTasks.id, { onDelete: "cascade" }),
    sequenceNo: integer("sequence_no").notNull(),
    eventType: text("event_type").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_a2a_task_events_task_sequence").on(t.taskId, t.sequenceNo),
    check("chk_a2a_task_events_sequence", sql`${t.sequenceNo} >= 1`),
  ],
);

export const a2aDebateSessions = sqliteTable(
  "a2a_debate_sessions",
  {
    id: text("id").primaryKey(),
    contextId: text("context_id").notNull().references(() => a2aContexts.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    status: text("status", { enum: ["ACTIVE", "FINALIZED", "ARCHIVED"] as const }).notNull(),
    currentRoundNo: integer("current_round_no").notNull().default(0),
    evidenceBoardJson: text("evidence_board_json").notNull().default("{}"),
    finalTaskId: text("final_task_id").references(() => a2aTasks.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_a2a_debate_sessions_context").on(t.contextId),
    check("chk_a2a_debate_sessions_status", sql`${t.status} IN ('ACTIVE','FINALIZED','ARCHIVED')`),
    check("chk_a2a_debate_sessions_round", sql`${t.currentRoundNo} >= 0`),
  ],
);

export const a2aDebateRounds = sqliteTable(
  "a2a_debate_rounds",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull().references(() => a2aDebateSessions.id, { onDelete: "cascade" }),
    roundNo: integer("round_no").notNull(),
    operation: text("operation").notNull(),
    focus: text("focus").notNull(),
    userStance: text("user_stance", { enum: ["NEUTRAL", "BULL", "BEAR"] as const }),
    judgeResultJson: text("judge_result_json").notNull(),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_a2a_debate_rounds_session_round").on(t.sessionId, t.roundNo),
    check("chk_a2a_debate_rounds_number", sql`${t.roundNo} >= 1`),
    check("chk_a2a_debate_rounds_stance", sql`${t.userStance} IS NULL OR ${t.userStance} IN ('NEUTRAL','BULL','BEAR')`),
  ],
);

export const a2aDebateTurns = sqliteTable(
  "a2a_debate_turns",
  {
    id: text("id").primaryKey(),
    roundId: text("round_id").notNull().references(() => a2aDebateRounds.id, { onDelete: "cascade" }),
    sequenceNo: integer("sequence_no").notNull(),
    role: text("role", { enum: ["USER", "ORCHESTRATOR", "EVIDENCE", "BULL", "BEAR", "JUDGE"] as const }).notNull(),
    content: text("content").notNull(),
    structuredOutputJson: text("structured_output_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_a2a_debate_turns_round_sequence").on(t.roundId, t.sequenceNo),
    check("chk_a2a_debate_turns_sequence", sql`${t.sequenceNo} >= 1`),
    check("chk_a2a_debate_turns_role", sql`${t.role} IN ('USER','ORCHESTRATOR','EVIDENCE','BULL','BEAR','JUDGE')`),
  ],
);

export type A2AExternalClientRow = typeof a2aExternalClients.$inferSelect;
export type A2AContextRow = typeof a2aContexts.$inferSelect;
export type A2ATaskRow = typeof a2aTasks.$inferSelect;
