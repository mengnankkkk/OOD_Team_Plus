# Bull Bear Debate Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend Agent layer for participatory bull/bear Battle debates, including debate state, LLM advocate roles, judge summaries, SSE events, evidence traceability, and final Chief Advisor handoff.

**Architecture:** Add a C-lite debate subsystem beside the existing advisor extension. The debate service owns sessions, rounds, turns, and orchestration; it reuses existing profile/portfolio/PandaData evidence gathering and `agent_runs` audit semantics. LLM agents generate strategy, advocate speeches, rebuttals, and judge summaries, while deterministic code only enforces shared facts, schema shape, persistence, idempotency, and publication gates.

**Tech Stack:** Next.js App Router route handlers, TypeScript, Zod, SQLite via `better-sqlite3`/Drizzle schema, Mastra Agent, DeepSeek OpenAI-compatible model, Vitest.

---

## File Structure

- `src/server/extensions/debate/contracts.ts`: Zod contracts and exported TypeScript types for debate roles, plans, speeches, turns, and judge summaries.
- `src/server/extensions/debate/service.ts`: Debate orchestration service for starting sessions and continuing rounds.
- `src/server/extensions/debate/evidence.ts`: Evidence board builder that reuses current profile, holdings, instruments, and PandaData research entry points.
- `src/server/extensions/debate/persistence.ts`: Small focused helpers for inserting debate sessions, rounds, turns, arguments, and judgements.
- `src/mastra/agents/debate-agents.ts`: Mastra specialists for Orchestrator, Bull Advocate, Bear Advocate, and Judge.
- `src/app/api/v1/debates/route.ts`: Create debate session endpoint.
- `src/app/api/v1/debates/[id]/turns/route.ts`: Continue debate endpoint.
- `src/app/api/v1/debates/[id]/route.ts`: Fetch debate session detail.
- `src/app/api/v1/debates/[id]/events/route.ts`: SSE route for debate events.
- `src/app/api/v1/debates/[id]/evidence-pack/route.ts`: Debate evidence pack route.
- `src/server/db/schema/core.ts`: Drizzle table definitions for debate persistence.
- `src/server/db/migrations/0015_add_debate_agent.sql`: SQLite migration for debate tables.
- `src/server/extensions/sse/event-persister.ts`: Add debate event names to the existing event whitelist.

---

### Task 1: Debate Contracts And SSE Event Names

**Files:**
- Create: `src/server/extensions/debate/contracts.ts`
- Create: `src/server/extensions/debate/contracts.test.ts`
- Modify: `src/server/extensions/sse/event-persister.ts`

- [ ] **Step 1: Write failing contract tests**

Create `src/server/extensions/debate/contracts.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import {
  AdvocateSpeechSchema,
  DebateJudgementSchema,
  DebateRoundPlanSchema,
  DebateTurnSchema,
} from "./contracts";

describe("debate contracts", () => {
  it("accepts a user-supported bull round plan", () => {
    const parsed = DebateRoundPlanSchema.parse({
      userDebateRole: "bull",
      userIntent: "support_bull",
      motion: "未来 1-3 个月是否应加仓 510300",
      roundFocus: "跌幅是否代表估值便宜",
      requiredAgents: ["evidence", "bull", "bear", "judge"],
      speakingOrder: ["evidence", "bull", "bear", "bull", "judge"],
      needsFreshData: true,
      reasonForFocus: "用户把跌幅作为看多理由，需要验证是否有估值或趋势证据支持。",
    });

    expect(parsed.userDebateRole).toBe("bull");
    expect(parsed.speakingOrder).toEqual(["evidence", "bull", "bear", "bull", "judge"]);
  });

  it("requires advocate speeches to include an admitted weakness", () => {
    const parsed = AdvocateSpeechSchema.parse({
      stance: "bull",
      headline: "跌幅后的修复空间值得讨论",
      directResponseToUser: "你说跌多了可能便宜，我会把它整理成估值修复假设。",
      arguments: [{
        stance: "bull",
        claim: "若估值已接近历史低位，分批观察比一次性追高更合理。",
        plainLanguage: "便宜要看估值，不只看跌了多少。",
        evidenceRefs: ["evidence_market_1"],
        counterEvidenceRefs: ["evidence_counter_1"],
        assumption: "估值分位真实处于偏低区域。",
        confidence: 0.62,
        vulnerability: "如果资金流继续走弱，估值便宜可能继续便宜。",
      }],
      strongestAttackOnOpponent: "空方需要说明下跌风险是否已经反映在价格里。",
      admittedWeakness: "目前缺少估值分位和资金流证据，不能只靠跌幅判断。",
      questionForOpponent: "你认为趋势风险还会持续的关键证据是什么？",
      plainLanguageSummary: "多方可以讨论，但还需要验证便宜是不是有数据支持。",
      suggestedUserFollowUp: "让多方解释估值是否真的便宜。",
    });

    expect(parsed.admittedWeakness).toContain("估值");
  });

  it("keeps judge output non-directional", () => {
    const parsed = DebateJudgementSchema.parse({
      userClaim: "用户认为跌多了可能可以加仓。",
      bullStrongestPoint: "多方把它转成估值修复假设。",
      bearStrongestPoint: "空方指出跌多不等于便宜。",
      keyDisagreement: "争议在于是否已有估值或趋势修复证据。",
      responseQuality: { bull: "direct", bear: "direct" },
      evidenceTilt: "insufficient_evidence",
      confidence: 0.58,
      whyNotFinal: "缺少估值分位、资金流和用户可承受回撤。",
      suggestedNextPrompts: ["让多方解释估值是否真的便宜", "让空方说明最大下跌风险"],
      complianceNote: "本轮只用于研究和模拟，不构成交易指令。",
    });

    expect(parsed.evidenceTilt).toBe("insufficient_evidence");
    expect(parsed.suggestedNextPrompts).toHaveLength(2);
  });

  it("accepts persisted public turns", () => {
    const parsed = DebateTurnSchema.parse({
      speaker: "judge",
      stance: "neutral",
      turnType: "judge_summary",
      content: "本轮证据不足，下一轮应追问估值是否真的便宜。",
      publicSummary: "证据不足，继续追问估值。",
      structuredPayload: { evidenceTilt: "insufficient_evidence" },
    });

    expect(parsed.speaker).toBe("judge");
  });
});
```

- [ ] **Step 2: Run the contract test and verify it fails**

Run:

```bash
pnpm vitest run src/server/extensions/debate/contracts.test.ts
```

Expected: FAIL because `src/server/extensions/debate/contracts.ts` does not exist.

- [ ] **Step 3: Add debate contracts**

Create `src/server/extensions/debate/contracts.ts`:

```typescript
import { z } from "zod";

export const DebateUserRoleSchema = z.enum(["neutral", "bull", "bear"]);
export const DebateSpeakerSchema = z.enum(["user", "bull", "bear", "judge", "orchestrator", "evidence"]);
export const DebateStanceSchema = z.enum(["bull", "bear", "neutral"]);
export const DebateAgentSchema = z.enum(["evidence", "bull", "bear", "judge", "chief_advisor"]);
export const DebateUserIntentSchema = z.enum([
  "ask_both",
  "support_bull",
  "support_bear",
  "challenge_bull",
  "challenge_bear",
  "ask_judge",
  "provide_evidence",
]);
export const DebateTurnTypeSchema = z.enum([
  "opening",
  "support",
  "rebuttal",
  "cross_examination",
  "answer",
  "judge_summary",
  "evidence_update",
]);
export const DebateEvidenceTiltSchema = z.enum([
  "bull_slightly_stronger",
  "bear_slightly_stronger",
  "balanced",
  "insufficient_evidence",
]);
export const DebateResponseQualitySchema = z.enum(["direct", "partial", "evasive", "not_applicable"]);

export const DebateArgumentSchema = z.object({
  stance: z.enum(["bull", "bear"]),
  claim: z.string().min(1),
  plainLanguage: z.string().min(1),
  evidenceRefs: z.array(z.string()).default([]),
  counterEvidenceRefs: z.array(z.string()).default([]),
  assumption: z.string().min(1),
  confidence: z.number().min(0).max(1),
  vulnerability: z.string().min(1),
});

export const AdvocateSpeechSchema = z.object({
  stance: z.enum(["bull", "bear"]),
  headline: z.string().min(1),
  directResponseToUser: z.string().min(1),
  arguments: z.array(DebateArgumentSchema).min(1).max(3),
  strongestAttackOnOpponent: z.string().min(1),
  admittedWeakness: z.string().min(1),
  questionForOpponent: z.string().min(1),
  plainLanguageSummary: z.string().min(1),
  suggestedUserFollowUp: z.string().min(1),
});

export const DebateJudgementSchema = z.object({
  userClaim: z.string().min(1),
  bullStrongestPoint: z.string().min(1),
  bearStrongestPoint: z.string().min(1),
  keyDisagreement: z.string().min(1),
  responseQuality: z.object({ bull: DebateResponseQualitySchema, bear: DebateResponseQualitySchema }),
  evidenceTilt: DebateEvidenceTiltSchema,
  confidence: z.number().min(0).max(1),
  whyNotFinal: z.string().min(1),
  suggestedNextPrompts: z.array(z.string().min(1)).min(1).max(3),
  complianceNote: z.string().min(1),
});

export const DebateRoundPlanSchema = z.object({
  userDebateRole: DebateUserRoleSchema,
  userIntent: DebateUserIntentSchema,
  motion: z.string().min(1),
  roundFocus: z.string().min(1),
  requiredAgents: z.array(DebateAgentSchema).min(1),
  speakingOrder: z.array(DebateAgentSchema).min(1),
  needsFreshData: z.boolean(),
  reasonForFocus: z.string().min(1),
});

export const DebateTurnSchema = z.object({
  speaker: DebateSpeakerSchema,
  stance: DebateStanceSchema,
  turnType: DebateTurnTypeSchema,
  content: z.string().min(1),
  publicSummary: z.string().min(1),
  structuredPayload: z.record(z.string(), z.unknown()).default({}),
});

export type DebateUserRole = z.infer<typeof DebateUserRoleSchema>;
export type DebateSpeaker = z.infer<typeof DebateSpeakerSchema>;
export type DebateStance = z.infer<typeof DebateStanceSchema>;
export type DebateAgent = z.infer<typeof DebateAgentSchema>;
export type DebateUserIntent = z.infer<typeof DebateUserIntentSchema>;
export type DebateTurnType = z.infer<typeof DebateTurnTypeSchema>;
export type DebateArgument = z.infer<typeof DebateArgumentSchema>;
export type AdvocateSpeech = z.infer<typeof AdvocateSpeechSchema>;
export type DebateJudgement = z.infer<typeof DebateJudgementSchema>;
export type DebateRoundPlan = z.infer<typeof DebateRoundPlanSchema>;
export type DebateTurn = z.infer<typeof DebateTurnSchema>;
```

- [ ] **Step 4: Add debate event names**

Modify `src/server/extensions/sse/event-persister.ts` by adding these values to `SSE_EVENT_TYPES` after `recommendation.created`:

```typescript
  "debate.started",
  "debate.round.started",
  "debate.evidence.started",
  "debate.evidence.completed",
  "debate.agent.started",
  "debate.agent.completed",
  "debate.speech.delta",
  "debate.turn.completed",
  "debate.judge.started",
  "debate.judge.completed",
  "debate.round.completed",
  "debate.blocked",
```

- [ ] **Step 5: Run the contract test and typecheck**

Run:

```bash
pnpm vitest run src/server/extensions/debate/contracts.test.ts
pnpm typecheck
```

Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/extensions/debate/contracts.ts src/server/extensions/debate/contracts.test.ts src/server/extensions/sse/event-persister.ts
git commit -m "feat: add debate agent contracts"
```

---

### Task 2: Debate Persistence Schema

**Files:**
- Modify: `src/server/db/schema/core.ts`
- Create: `src/server/db/migrations/0015_add_debate_agent.sql`
- Create: `src/server/extensions/debate/persistence.ts`
- Create: `src/server/extensions/debate/persistence.test.ts`

- [ ] **Step 1: Write failing persistence test**

Create `src/server/extensions/debate/persistence.test.ts`:

```typescript
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { seedAuthenticatedUser, TEST_USER_ID } from "@tests/helpers/auth";
import { getDatabase } from "@/server/http/context";
import { createDebateSession, createDebateRound, createDebateTurn, createDebateJudgement } from "./persistence";

let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-debate-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
  seedAuthenticatedUser();
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
});

describe("debate persistence", () => {
  it("persists session, round, turn, and judgement records", () => {
    const db = getDatabase();
    db.prepare("INSERT INTO conversation_sessions (id,user_id,title,status,created_at,updated_at,row_version) VALUES ('conversation_debate',?,'Battle','active','2026-07-25T00:00:00.000Z','2026-07-25T00:00:00.000Z',1)").run(TEST_USER_ID);
    db.prepare("INSERT INTO agent_runs (id,user_id,type,status,session_id,created_at) VALUES ('analysis_debate',?,'debate_agent','running','conversation_debate','2026-07-25T00:00:00.000Z')").run(TEST_USER_ID);

    const sessionId = createDebateSession(db, {
      userId: TEST_USER_ID,
      conversationId: "conversation_debate",
      rootAgentRunId: "analysis_debate",
      motion: "未来 1-3 个月是否应加仓 510300",
      targetSymbol: "510300.OF",
      userDebateRole: "neutral",
    });
    const roundId = createDebateRound(db, {
      debateSessionId: sessionId,
      roundIndex: 1,
      roundFocus: "跌幅是否代表便宜",
      userIntent: "ask_both",
    });
    const turnId = createDebateTurn(db, {
      debateSessionId: sessionId,
      debateRoundId: roundId,
      speaker: "bull",
      stance: "bull",
      turnType: "opening",
      content: "多方认为估值修复值得讨论。",
      publicSummary: "多方强调估值修复假设。",
      structuredPayload: { headline: "估值修复" },
    });
    createDebateJudgement(db, {
      debateSessionId: sessionId,
      debateRoundId: roundId,
      userClaim: "用户想知道跌多了能否加仓。",
      bullStrongestPoint: "估值修复值得验证。",
      bearStrongestPoint: "跌多不等于便宜。",
      keyDisagreement: "估值是否真的便宜。",
      responseQuality: { bull: "direct", bear: "direct" },
      evidenceTilt: "balanced",
      confidence: 0.55,
      whyNotFinal: "缺少估值分位。",
      suggestedNextPrompts: ["让多方解释估值是否真的便宜"],
      complianceNote: "仅用于研究和模拟。",
    });

    const savedTurn = db.prepare("SELECT * FROM debate_turns WHERE id=?").get(turnId) as Record<string, unknown> | undefined;
    const savedJudgement = db.prepare("SELECT * FROM debate_judgements WHERE debate_round_id=?").get(roundId) as Record<string, unknown> | undefined;
    db.close();

    expect(savedTurn?.speaker).toBe("bull");
    expect(JSON.parse(String(savedTurn?.structured_payload_json))).toEqual({ headline: "估值修复" });
    expect(savedJudgement?.evidence_tilt).toBe("balanced");
  });
});
```

- [ ] **Step 2: Run the persistence test and verify it fails**

Run:

```bash
pnpm vitest run src/server/extensions/debate/persistence.test.ts
```

Expected: FAIL because persistence helpers and debate tables do not exist.

- [ ] **Step 3: Add SQLite migration**

Create `src/server/db/migrations/0015_add_debate_agent.sql`:

```sql
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
```

- [ ] **Step 4: Add Drizzle schema definitions**

Modify `src/server/db/schema/core.ts` after `agentRunEvents` and before `instruments`:

```typescript
export const debateSessions = sqliteTable(
  "debate_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    conversationId: text("conversation_id").notNull(),
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
    debateSessionId: text("debate_session_id").notNull(),
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
    index("idx_debate_rounds_session_created").on(t.debateSessionId, t.createdAt),
  ],
);

export const debateTurns = sqliteTable(
  "debate_turns",
  {
    id: text("id").primaryKey(),
    debateSessionId: text("debate_session_id").notNull(),
    debateRoundId: text("debate_round_id").notNull(),
    speaker: text("speaker").notNull(),
    stance: text("stance").notNull(),
    turnType: text("turn_type").notNull(),
    content: text("content").notNull(),
    publicSummary: text("public_summary").notNull(),
    structuredPayloadJson: text("structured_payload_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
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
    debateSessionId: text("debate_session_id").notNull(),
    debateRoundId: text("debate_round_id").notNull(),
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
  (t) => [uniqueIndex("idx_debate_judgements_round").on(t.debateRoundId)],
);
```

- [ ] **Step 5: Add persistence helpers**

Create `src/server/extensions/debate/persistence.ts`:

```typescript
import { createId, isoNow, json } from "@/server/http/context";

import type { SqliteDb } from "@/server/db/client.runtime";
import type { DebateJudgement, DebateTurn, DebateUserIntent, DebateUserRole } from "./contracts";

export function createDebateSession(db: SqliteDb, input: {
  userId: string;
  conversationId: string;
  rootAgentRunId: string;
  motion: string;
  targetInstrumentId?: string | null;
  targetSymbol?: string | null;
  userDebateRole: DebateUserRole;
}): string {
  const now = isoNow();
  const id = createId("debate");
  db.prepare(`INSERT INTO debate_sessions
    (id,user_id,conversation_id,root_agent_run_id,motion,target_instrument_id,target_symbol,user_debate_role,status,current_round_index,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?, 'active',0,?,?)`).run(
    id,
    input.userId,
    input.conversationId,
    input.rootAgentRunId,
    input.motion,
    input.targetInstrumentId ?? null,
    input.targetSymbol ?? null,
    input.userDebateRole,
    now,
    now,
  );
  return id;
}

export function createDebateRound(db: SqliteDb, input: {
  debateSessionId: string;
  roundIndex: number;
  roundFocus: string;
  userIntent: DebateUserIntent;
}): string {
  const now = isoNow();
  const id = createId("debate_round");
  db.prepare(`INSERT INTO debate_rounds
    (id,debate_session_id,round_index,round_focus,user_intent,status,created_at)
    VALUES (?,?,?,?,?,'running',?)`).run(id, input.debateSessionId, input.roundIndex, input.roundFocus, input.userIntent, now);
  db.prepare("UPDATE debate_sessions SET current_round_index=?,updated_at=? WHERE id=?")
    .run(input.roundIndex, now, input.debateSessionId);
  return id;
}

export function createDebateTurn(db: SqliteDb, input: DebateTurn & { debateSessionId: string; debateRoundId: string }): string {
  const id = createId("debate_turn");
  const now = isoNow();
  db.prepare(`INSERT INTO debate_turns
    (id,debate_session_id,debate_round_id,speaker,stance,turn_type,content,public_summary,structured_payload_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    id,
    input.debateSessionId,
    input.debateRoundId,
    input.speaker,
    input.stance,
    input.turnType,
    input.content,
    input.publicSummary,
    json(input.structuredPayload),
    now,
  );
  return id;
}

export function createDebateJudgement(db: SqliteDb, input: DebateJudgement & { debateSessionId: string; debateRoundId: string }): string {
  const id = createId("debate_judgement");
  const now = isoNow();
  db.prepare(`INSERT INTO debate_judgements
    (id,debate_session_id,debate_round_id,user_claim,bull_strongest_point,bear_strongest_point,key_disagreement,response_quality_json,evidence_tilt,confidence_decimal,why_not_final,suggested_next_prompts_json,compliance_note,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id,
    input.debateSessionId,
    input.debateRoundId,
    input.userClaim,
    input.bullStrongestPoint,
    input.bearStrongestPoint,
    input.keyDisagreement,
    json(input.responseQuality),
    input.evidenceTilt,
    String(input.confidence),
    input.whyNotFinal,
    json(input.suggestedNextPrompts),
    input.complianceNote,
    now,
  );
  db.prepare("UPDATE debate_rounds SET status='completed',judge_summary_json=?,completed_at=? WHERE id=?")
    .run(json(input), now, input.debateRoundId);
  return id;
}
```

- [ ] **Step 6: Run persistence test and migration-sensitive tests**

Run:

```bash
pnpm vitest run src/server/extensions/debate/persistence.test.ts src/server/db/schema/artifacts.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/db/schema/core.ts src/server/db/migrations/0015_add_debate_agent.sql src/server/extensions/debate/persistence.ts src/server/extensions/debate/persistence.test.ts
git commit -m "feat: persist debate sessions"
```

---

### Task 3: Mastra Debate Agents

**Files:**
- Create: `src/mastra/agents/debate-agents.ts`
- Create: `src/mastra/agents/debate-agents.test.ts`

- [ ] **Step 1: Write coercion tests**

Create `src/mastra/agents/debate-agents.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { coerceAdvocateSpeech, coerceDebateJudgement, coerceDebateRoundPlan } from "./debate-agents";

describe("debate agent coercion", () => {
  it("coerces a sparse round plan into a safe judge-led plan", () => {
    const plan = coerceDebateRoundPlan({ motion: "是否加仓 510300" });
    expect(plan.userDebateRole).toBe("neutral");
    expect(plan.userIntent).toBe("ask_both");
    expect(plan.requiredAgents).toContain("judge");
  });

  it("coerces advocate speech without losing admitted weakness", () => {
    const speech = coerceAdvocateSpeech("bear", {
      headline: "趋势没有修复前先谨慎",
      directResponseToUser: "你的担心可以表达为趋势风险假设。",
      admittedWeakness: "如果估值已足够低，空方需要重新评估。",
    });
    expect(speech.stance).toBe("bear");
    expect(speech.arguments[0].stance).toBe("bear");
    expect(speech.admittedWeakness).toContain("估值");
  });

  it("coerces judge summaries into non-final evidence tilt", () => {
    const judgement = coerceDebateJudgement({ userClaim: "我觉得跌多了可以买" });
    expect(judgement.userClaim).toContain("跌多");
    expect(judgement.evidenceTilt).toBe("insufficient_evidence");
    expect(judgement.complianceNote).toContain("研究");
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
pnpm vitest run src/mastra/agents/debate-agents.test.ts
```

Expected: FAIL because `debate-agents.ts` does not exist.

- [ ] **Step 3: Add debate Mastra agents and coercion helpers**

Create `src/mastra/agents/debate-agents.ts`:

```typescript
import { Agent } from "@mastra/core/agent";
import { z } from "zod";

import { getDeepSeekModelConfig } from "@/server/extensions/advisor/model-config";
import {
  AdvocateSpeechSchema,
  DebateJudgementSchema,
  DebateRoundPlanSchema,
  type AdvocateSpeech,
  type DebateAgent,
  type DebateJudgement,
  type DebateRoundPlan,
} from "@/server/extensions/debate/contracts";

const PartialPlanSchema = DebateRoundPlanSchema.partial();
const PartialSpeechSchema = AdvocateSpeechSchema.partial();
const PartialJudgementSchema = DebateJudgementSchema.partial();

export function createDebateAgents() {
  return {
    orchestrator: debateAgent("debate-orchestrator", "Debate Orchestrator", [
      "你负责把用户消息转成多空辩论回合计划。",
      "你要判断用户是中立提问、站多方、站空方、质询、补证据还是要求裁判总结。",
      "你可以自由选择本轮焦点，但必须让输出符合 DebateRoundPlan JSON。",
    ]),
    bull: debateAgent("debate-bull-advocate", "Bull Advocate", [
      "你是看多方。你要主动寻找最强看多路径，并把理财小白的直觉升级成可检验假设。",
      "你必须承认一个对多方不利的关键弱点，不得编造数据，不得输出必须买入。",
      "你只输出 AdvocateSpeech JSON。",
    ]),
    bear: debateAgent("debate-bear-advocate", "Bear Advocate", [
      "你是看空方。你要主动压力测试多方假设，并把用户担忧升级成可检验风险假设。",
      "你必须承认一个对空方不利的关键反证，不得恐吓用户，不得输出必须卖出。",
      "你只输出 AdvocateSpeech JSON。",
    ]),
    judge: debateAgent("debate-judge", "Debate Judge", [
      "你是教学型裁判。你要用理财小白能听懂的话总结双方证据和用户观点。",
      "你的结论只能是证据天平，不是交易指令。",
      "你只输出 DebateJudgement JSON。",
    ]),
  };
}

export async function runDebateOrchestrator(prompt: string): Promise<DebateRoundPlan> {
  const { orchestrator } = createDebateAgents();
  const result = await streamObject(orchestrator, prompt, PartialPlanSchema);
  return coerceDebateRoundPlan(result);
}

export async function runDebateAdvocate(stance: "bull" | "bear", prompt: string): Promise<AdvocateSpeech> {
  const agents = createDebateAgents();
  const result = await streamObject(stance === "bull" ? agents.bull : agents.bear, prompt, PartialSpeechSchema);
  return coerceAdvocateSpeech(stance, result);
}

export async function runDebateJudge(prompt: string): Promise<DebateJudgement> {
  const { judge } = createDebateAgents();
  const result = await streamObject(judge, prompt, PartialJudgementSchema);
  return coerceDebateJudgement(result);
}

export function coerceDebateRoundPlan(value: unknown): DebateRoundPlan {
  const record = plainRecord(value);
  const requiredAgents = coerceAgents(record.requiredAgents);
  const speakingOrder = coerceAgents(record.speakingOrder);
  return DebateRoundPlanSchema.parse({
    userDebateRole: record.userDebateRole === "bull" || record.userDebateRole === "bear" ? record.userDebateRole : "neutral",
    userIntent: typeof record.userIntent === "string" ? record.userIntent : "ask_both",
    motion: nonEmpty(record.motion, "围绕当前标的是否值得继续研究展开多空辩论"),
    roundFocus: nonEmpty(record.roundFocus, "用户问题中的核心投资假设"),
    requiredAgents: requiredAgents.length ? requiredAgents : ["evidence", "bull", "bear", "judge"],
    speakingOrder: speakingOrder.length ? speakingOrder : ["evidence", "bull", "bear", "judge"],
    needsFreshData: typeof record.needsFreshData === "boolean" ? record.needsFreshData : true,
    reasonForFocus: nonEmpty(record.reasonForFocus, "需要先把用户直觉转成可验证假设，再由反方压力测试。"),
  });
}

export function coerceAdvocateSpeech(stance: "bull" | "bear", value: unknown): AdvocateSpeech {
  const record = plainRecord(value);
  const fallbackClaim = stance === "bull"
    ? "看多方认为该方向可以继续研究，但必须先验证关键证据。"
    : "看空方认为当前应保持谨慎，直到关键风险被验证或缓解。";
  return AdvocateSpeechSchema.parse({
    stance,
    headline: nonEmpty(record.headline, stance === "bull" ? "看多假设需要证据验证" : "看空风险需要压力测试"),
    directResponseToUser: nonEmpty(record.directResponseToUser, "我会先把你的观点整理成一个可以验证的投资假设。"),
    arguments: coerceArguments(stance, record.arguments, fallbackClaim),
    strongestAttackOnOpponent: nonEmpty(record.strongestAttackOnOpponent, "对方需要解释自己的核心假设是否有足够证据。"),
    admittedWeakness: nonEmpty(record.admittedWeakness, "本方观点仍缺少一项关键证据，不能直接升级为行动建议。"),
    questionForOpponent: nonEmpty(record.questionForOpponent, "你方最关键的证据是什么？"),
    plainLanguageSummary: nonEmpty(record.plainLanguageSummary, "这只是一个需要验证的观点，不是直接行动指令。"),
    suggestedUserFollowUp: nonEmpty(record.suggestedUserFollowUp, "让对方解释最关键的数据依据。"),
  });
}

export function coerceDebateJudgement(value: unknown): DebateJudgement {
  const record = plainRecord(value);
  return DebateJudgementSchema.parse({
    userClaim: nonEmpty(record.userClaim, "用户希望判断当前观点是否有足够证据支持。"),
    bullStrongestPoint: nonEmpty(record.bullStrongestPoint, "多方提出了需要验证的看多假设。"),
    bearStrongestPoint: nonEmpty(record.bearStrongestPoint, "空方指出了不能忽略的风险假设。"),
    keyDisagreement: nonEmpty(record.keyDisagreement, "双方分歧在于证据是否足以支持行动。"),
    responseQuality: {
      bull: responseQuality(plainRecord(record.responseQuality).bull),
      bear: responseQuality(plainRecord(record.responseQuality).bear),
    },
    evidenceTilt: tilt(record.evidenceTilt),
    confidence: confidence(record.confidence),
    whyNotFinal: nonEmpty(record.whyNotFinal, "还缺少关键数据或个人约束，因此不能形成最终交易结论。"),
    suggestedNextPrompts: stringArray(record.suggestedNextPrompts).slice(0, 3).length
      ? stringArray(record.suggestedNextPrompts).slice(0, 3)
      : ["让多方解释最关键证据", "让空方说明最大风险"],
    complianceNote: nonEmpty(record.complianceNote, "本轮仅用于投资研究和方案模拟，不构成交易指令。"),
  });
}

async function streamObject<T extends object>(agent: Agent, prompt: string, schema: z.ZodType<T>): Promise<T> {
  const stream = await agent.stream(prompt, { structuredOutput: { schema }, maxSteps: 1, modelSettings: { maxOutputTokens: 1_400, temperature: 0.2 } });
  const result = await stream.object;
  if (!result || typeof result !== "object") throw new Error("MODEL_OUTPUT_EMPTY");
  return result as T;
}

function debateAgent(id: string, name: string, instructions: string[]): Agent {
  return new Agent({
    id,
    name,
    description: `${name} for participatory bull/bear investment debate.`,
    model: getDeepSeekModelConfig(),
    defaultOptions: { maxSteps: 1, modelSettings: { maxOutputTokens: 1_200, temperature: 0.2 } },
    instructions: instructions.join("\n"),
  });
}

function coerceAgents(value: unknown): DebateAgent[] {
  return stringArray(value).filter((item): item is DebateAgent => ["evidence", "bull", "bear", "judge", "chief_advisor"].includes(item));
}

function coerceArguments(stance: "bull" | "bear", value: unknown, fallbackClaim: string) {
  const values = Array.isArray(value) ? value : [];
  const parsed = values.map(plainRecord).map((item) => ({
    stance,
    claim: nonEmpty(item.claim, fallbackClaim),
    plainLanguage: nonEmpty(item.plainLanguage, "这条观点需要被数据验证。"),
    evidenceRefs: stringArray(item.evidenceRefs),
    counterEvidenceRefs: stringArray(item.counterEvidenceRefs),
    assumption: nonEmpty(item.assumption, "核心假设仍需验证。"),
    confidence: confidence(item.confidence),
    vulnerability: nonEmpty(item.vulnerability, "如果关键证据不成立，本方观点会变弱。"),
  }));
  return parsed.length ? parsed.slice(0, 3) : [{
    stance,
    claim: fallbackClaim,
    plainLanguage: "这条观点需要被数据验证。",
    evidenceRefs: [],
    counterEvidenceRefs: [],
    assumption: "核心假设仍需验证。",
    confidence: 0.35,
    vulnerability: "如果关键证据不成立，本方观点会变弱。",
  }];
}

function responseQuality(value: unknown) {
  return value === "direct" || value === "partial" || value === "evasive" ? value : "not_applicable";
}

function tilt(value: unknown) {
  return value === "bull_slightly_stronger" || value === "bear_slightly_stronger" || value === "balanced"
    ? value
    : "insufficient_evidence";
}

function confidence(value: unknown): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) ? Math.min(1, Math.max(0, numeric)) : 0.35;
}

function stringArray(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return values.map((item) => String(item).trim()).filter(Boolean);
}

function nonEmpty(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function plainRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
```

- [ ] **Step 4: Run agent coercion tests and typecheck**

Run:

```bash
pnpm vitest run src/mastra/agents/debate-agents.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mastra/agents/debate-agents.ts src/mastra/agents/debate-agents.test.ts
git commit -m "feat: add debate llm agents"
```

---

### Task 4: Debate Evidence Board

**Files:**
- Create: `src/server/extensions/debate/evidence.ts`
- Create: `src/server/extensions/debate/evidence.test.ts`

- [ ] **Step 1: Write evidence builder tests**

Create `src/server/extensions/debate/evidence.test.ts`:

```typescript
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { seedAuthenticatedUser, TEST_USER_ID } from "@tests/helpers/auth";
import { getDatabase } from "@/server/http/context";
import { buildDebateEvidenceBoard } from "./evidence";

let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-debate-evidence-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
  seedAuthenticatedUser();
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
});

describe("debate evidence board", () => {
  it("loads profile, holdings, and user claims into a shared evidence board", async () => {
    const db = getDatabase();
    db.prepare("INSERT INTO user_profiles (id,user_id,risk_level,investment_amount_decimal,horizon,max_drawdown_decimal,preferences_json,status,created_at,updated_at) VALUES ('profile_1',?,'BALANCED','10000','MEDIUM','0.1','{}','active','2026-07-25T00:00:00.000Z','2026-07-25T00:00:00.000Z')").run(TEST_USER_ID);
    db.prepare("INSERT INTO instruments (id,symbol,name,market,asset_type,tradable) VALUES ('instrument_510300','510300.OF','沪深300ETF','OF','ETF',1)").run();
    db.prepare("INSERT INTO portfolio_snapshots (id,user_id,portfolio_id,cash_decimal,total_market_value_decimal,data_quality,source_statuses_json,as_of,created_at) VALUES ('snapshot_1',?,'portfolio_1','5000','10000','complete','[]','2026-07-25T00:00:00.000Z','2026-07-25T00:00:00.000Z')").run(TEST_USER_ID);
    db.prepare("INSERT INTO holding_snapshots (id,portfolio_snapshot_id,instrument_id,quantity_decimal,cost_decimal,price_decimal,market_value_decimal,unrealized_pnl_decimal,weight_bps,created_at) VALUES ('holding_1','snapshot_1','instrument_510300','100','3','2.8','280','-20',280,'2026-07-25T00:00:00.000Z')").run();
    db.close();

    const board = await buildDebateEvidenceBoard({
      userId: TEST_USER_ID,
      debateSessionId: "debate_1",
      rootAgentRunId: "analysis_1",
      motion: "是否加仓 510300",
      targetSymbol: "510300.OF",
      userClaims: ["我只打算持有两周"],
      dbCall: async () => [],
    });

    expect(board.profileFacts.some((item) => item.includes("BALANCED"))).toBe(true);
    expect(board.portfolioFacts.some((item) => item.includes("510300.OF"))).toBe(true);
    expect(board.userClaims).toEqual(["我只打算持有两周"]);
  });
});
```

- [ ] **Step 2: Run evidence test and verify it fails**

Run:

```bash
pnpm vitest run src/server/extensions/debate/evidence.test.ts
```

Expected: FAIL because `evidence.ts` does not exist.

- [ ] **Step 3: Add evidence board builder**

Create `src/server/extensions/debate/evidence.ts`:

```typescript
import { executePandaSources, type PandaSourceExecution } from "@/server/extensions/query/panda-query-executor";
import type { PandaQuerySource } from "@/server/extensions/query/market-catalog";
import { getDatabase } from "@/server/http/context";

export interface DebateEvidenceBoard {
  debateSessionId: string;
  rootAgentRunId: string;
  motion: string;
  targetSymbol: string | null;
  profileFacts: string[];
  portfolioFacts: string[];
  marketFacts: string[];
  userClaims: string[];
  missingData: string[];
  pandaExecutions: PandaSourceExecution[];
}

type DbCall = typeof executePandaSources;

export async function buildDebateEvidenceBoard(input: {
  userId: string;
  debateSessionId: string;
  rootAgentRunId: string;
  motion: string;
  targetSymbol?: string | null;
  userClaims?: string[];
  dbCall?: DbCall;
}): Promise<DebateEvidenceBoard> {
  const db = getDatabase();
  const profile = db.prepare("SELECT risk_level,investment_amount_decimal,horizon,max_drawdown_decimal FROM user_profiles WHERE user_id=?").get(input.userId) as Record<string, unknown> | undefined;
  const snapshot = db.prepare("SELECT * FROM portfolio_snapshots WHERE user_id=? ORDER BY as_of DESC,created_at DESC LIMIT 1").get(input.userId) as Record<string, unknown> | undefined;
  const holdings = snapshot ? db.prepare(`SELECT hs.*,i.symbol,i.name,i.asset_type,i.market
    FROM holding_snapshots hs JOIN instruments i ON i.id=hs.instrument_id
    WHERE hs.portfolio_snapshot_id=? ORDER BY hs.weight_bps DESC`).all(snapshot.id) as Array<Record<string, unknown>> : [];
  const target = input.targetSymbol ? db.prepare("SELECT id,symbol,name,asset_type,market FROM instruments WHERE UPPER(symbol)=UPPER(?) LIMIT 1").get(input.targetSymbol) as Record<string, unknown> | undefined : undefined;

  let pandaExecutions: PandaSourceExecution[] = [];
  const source = target ? pandaSourceFor(target) : null;
  if (source) {
    try {
      pandaExecutions = await (input.dbCall ?? executePandaSources)({ sources: [source], agentRunId: input.rootAgentRunId, localRows: [], db });
    } catch {
      pandaExecutions = [];
    }
  }
  db.close();

  const profileFacts = profile ? [
    `风险等级：${String(profile.risk_level ?? "未知")}`,
    `可投资金额：${String(profile.investment_amount_decimal ?? "未知")}`,
    `投资期限：${String(profile.horizon ?? "未知")}`,
    `最大回撤：${String(profile.max_drawdown_decimal ?? "未知")}`,
  ] : [];
  const portfolioFacts = holdings.map((holding) => `${String(holding.symbol)} ${String(holding.name)} 权重 ${String(holding.weight_bps)}bps，浮盈亏 ${String(holding.unrealized_pnl_decimal)}`);
  const marketFacts = pandaExecutions.flatMap((execution) => execution.result.data.slice(0, 3).map((row) => `${String(row.symbol ?? execution.source.dataset)} ${String(row.date ?? row.trade_date ?? execution.result.asOfDate ?? "未知日期")} close=${String(row.close ?? "未知")}`));
  const missingData = [
    profile ? null : "profile",
    holdings.length ? null : "holdings",
    input.targetSymbol && !target ? "target_instrument" : null,
    source && pandaExecutions.length === 0 ? "market_data" : null,
  ].filter((value): value is string => Boolean(value));

  return {
    debateSessionId: input.debateSessionId,
    rootAgentRunId: input.rootAgentRunId,
    motion: input.motion,
    targetSymbol: input.targetSymbol ?? null,
    profileFacts,
    portfolioFacts,
    marketFacts,
    userClaims: input.userClaims ?? [],
    missingData,
    pandaExecutions,
  };
}

function pandaSourceFor(target: Record<string, unknown>): PandaQuerySource {
  const symbol = String(target.symbol);
  const assetType = String(target.asset_type ?? "STOCK");
  const market = String(target.market ?? "UNKNOWN");
  const method = assetType.toUpperCase().includes("ETF") || assetType.toUpperCase().includes("FUND")
    ? "get_fund_daily"
    : assetType.toUpperCase().includes("INDEX")
      ? "get_index_daily"
      : market.toUpperCase() === "US"
        ? "get_us_daily"
        : market.toUpperCase() === "HK"
          ? "get_hk_daily"
          : "get_stock_rt_daily";
  const end = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 180);
  const columns = ["symbol", "date", "open", "high", "low", "close", "volume", "amount"];
  return {
    dataset: method === "get_fund_daily" ? "MARKET_FUND_DAILY" : method === "get_index_daily" ? "MARKET_INDEX_DAILY" : method === "get_us_daily" ? "MARKET_US_DAILY" : method === "get_hk_daily" ? "MARKET_HK_DAILY" : "MARKET_STOCK_RT_DAILY",
    method,
    parameters: method === "get_stock_rt_daily"
      ? { symbol: [symbol], fields: columns }
      : { symbol: [symbol], start_date: start.toISOString().slice(0, 10).replaceAll("-", ""), end_date: end, fields: columns },
    columns,
    joinKeys: ["symbol", "date"],
    assetType,
  };
}
```

- [ ] **Step 4: Run evidence tests and typecheck**

Run:

```bash
pnpm vitest run src/server/extensions/debate/evidence.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/extensions/debate/evidence.ts src/server/extensions/debate/evidence.test.ts
git commit -m "feat: build debate evidence board"
```

---

### Task 5: Debate Service Orchestration

**Files:**
- Create: `src/server/extensions/debate/service.ts`
- Create: `src/server/extensions/debate/service.test.ts`

- [ ] **Step 1: Write service tests with injected model runners**

Create `src/server/extensions/debate/service.test.ts`:

```typescript
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { seedAuthenticatedUser, TEST_USER_ID } from "@tests/helpers/auth";
import { getDatabase } from "@/server/http/context";
import { continueDebate, startDebate } from "./service";

let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-debate-service-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
  seedAuthenticatedUser();
  const db = getDatabase();
  db.prepare("INSERT INTO conversation_sessions (id,user_id,title,status,created_at,updated_at,row_version) VALUES ('conversation_debate',?,'Battle','active','2026-07-25T00:00:00.000Z','2026-07-25T00:00:00.000Z',1)").run(TEST_USER_ID);
  db.prepare("INSERT INTO instruments (id,symbol,name,market,asset_type,tradable) VALUES ('instrument_510300','510300.OF','沪深300ETF','OF','ETF',1)").run();
  db.close();
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
});

const runners = {
  plan: async () => ({
    userDebateRole: "neutral" as const,
    userIntent: "ask_both" as const,
    motion: "未来 1-3 个月是否应加仓 510300",
    roundFocus: "跌幅是否代表便宜",
    requiredAgents: ["evidence", "bull", "bear", "judge"] as const,
    speakingOrder: ["evidence", "bull", "bear", "judge"] as const,
    needsFreshData: false,
    reasonForFocus: "用户需要理解跌幅和便宜不是一回事。",
  }),
  advocate: async (stance: "bull" | "bear") => ({
    stance,
    headline: stance === "bull" ? "估值修复值得验证" : "趋势风险仍需警惕",
    directResponseToUser: "我会用证据回应你的观点。",
    arguments: [{ stance, claim: "核心观点", plainLanguage: "白话观点", evidenceRefs: [], counterEvidenceRefs: [], assumption: "关键假设", confidence: 0.5, vulnerability: "关键漏洞" }],
    strongestAttackOnOpponent: "对方需要补充证据。",
    admittedWeakness: "本方也缺一项关键证据。",
    questionForOpponent: "你的关键证据是什么？",
    plainLanguageSummary: "这只是研究观点。",
    suggestedUserFollowUp: "继续追问关键证据。",
  }),
  judge: async () => ({
    userClaim: "用户询问是否加仓。",
    bullStrongestPoint: "多方提出估值修复。",
    bearStrongestPoint: "空方提出趋势风险。",
    keyDisagreement: "估值是否足够便宜。",
    responseQuality: { bull: "direct" as const, bear: "direct" as const },
    evidenceTilt: "balanced" as const,
    confidence: 0.55,
    whyNotFinal: "缺少更多证据。",
    suggestedNextPrompts: ["让多方解释估值是否真的便宜"],
    complianceNote: "仅用于研究和模拟。",
  }),
};

describe("debate service", () => {
  it("starts a debate with bull, bear, and judge turns", async () => {
    const result = await startDebate({
      userId: TEST_USER_ID,
      conversationId: "conversation_debate",
      message: "我现在要不要加仓 510300？",
      targetSymbol: "510300.OF",
      initialUserRole: "neutral",
      runners,
      evidenceCall: async () => ({ debateSessionId: "", rootAgentRunId: "", motion: "", targetSymbol: "510300.OF", profileFacts: [], portfolioFacts: [], marketFacts: [], userClaims: [], missingData: [], pandaExecutions: [] }),
    });

    expect(result.debateSessionId).toMatch(/^debate_/);
    expect(result.analysis.analysisId).toMatch(/^analysis_/);

    const db = getDatabase();
    const turns = db.prepare("SELECT speaker FROM debate_turns WHERE debate_session_id=? ORDER BY created_at,id").all(result.debateSessionId) as Array<{ speaker: string }>;
    db.close();
    expect(turns.map((turn) => turn.speaker)).toEqual(["user", "evidence", "bull", "bear", "judge"]);
  });

  it("continues a debate with a user standing bull", async () => {
    const started = await startDebate({ userId: TEST_USER_ID, conversationId: "conversation_debate", message: "是否加仓 510300？", targetSymbol: "510300.OF", initialUserRole: "neutral", runners, evidenceCall: async () => ({ debateSessionId: "", rootAgentRunId: "", motion: "", targetSymbol: "510300.OF", profileFacts: [], portfolioFacts: [], marketFacts: [], userClaims: [], missingData: [], pandaExecutions: [] }) });
    const continued = await continueDebate({ userId: TEST_USER_ID, debateSessionId: started.debateSessionId, content: "我站多方，跌多了可能便宜。", userRole: "bull", runners, evidenceCall: async () => ({ debateSessionId: "", rootAgentRunId: "", motion: "", targetSymbol: "510300.OF", profileFacts: [], portfolioFacts: [], marketFacts: [], userClaims: ["我站多方，跌多了可能便宜。"], missingData: [], pandaExecutions: [] }) });

    expect(continued.roundIndex).toBe(2);
    expect(continued.judgement.userClaim).toContain("用户询问");
  });
});
```

- [ ] **Step 2: Run service tests and verify they fail**

Run:

```bash
pnpm vitest run src/server/extensions/debate/service.test.ts
```

Expected: FAIL because `service.ts` does not exist.

- [ ] **Step 3: Add debate service**

Create `src/server/extensions/debate/service.ts` with injected runners for testability:

```typescript
import { persistSseEvent } from "@/server/extensions/sse/event-persister";
import { createId, getDatabase, isoNow, json } from "@/server/http/context";
import { runDebateAdvocate, runDebateJudge, runDebateOrchestrator } from "@/mastra/agents/debate-agents";

import { buildDebateEvidenceBoard, type DebateEvidenceBoard } from "./evidence";
import { AdvocateSpeechSchema, DebateJudgementSchema, DebateRoundPlanSchema, DebateTurnSchema, type AdvocateSpeech, type DebateJudgement, type DebateRoundPlan, type DebateUserRole } from "./contracts";
import { createDebateJudgement, createDebateRound, createDebateSession, createDebateTurn } from "./persistence";

type DebateRunners = {
  plan: (prompt: string) => Promise<DebateRoundPlan>;
  advocate: (stance: "bull" | "bear", prompt: string) => Promise<AdvocateSpeech>;
  judge: (prompt: string) => Promise<DebateJudgement>;
};

type EvidenceCall = typeof buildDebateEvidenceBoard;

const defaultRunners: DebateRunners = {
  plan: runDebateOrchestrator,
  advocate: runDebateAdvocate,
  judge: runDebateJudge,
};

export async function startDebate(input: {
  userId: string;
  conversationId: string;
  message: string;
  targetSymbol?: string | null;
  initialUserRole?: DebateUserRole;
  runners?: DebateRunners;
  evidenceCall?: EvidenceCall;
}) {
  const runners = input.runners ?? defaultRunners;
  const evidenceCall = input.evidenceCall ?? buildDebateEvidenceBoard;
  const db = getDatabase();
  const conversation = db.prepare("SELECT id FROM conversation_sessions WHERE id=? AND user_id=? AND status='active'").get(input.conversationId, input.userId);
  if (!conversation) { db.close(); throw new Error("Conversation not found"); }
  const now = isoNow();
  const analysisId = createId("analysis");
  db.prepare("INSERT INTO agent_runs (id,user_id,type,status,session_id,agent_type,objective,created_at,started_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(analysisId, input.userId, "debate_agent", "running", input.conversationId, "debate_orchestrator", input.message.slice(0, 500), now, now);
  const sessionId = createDebateSession(db, {
    userId: input.userId,
    conversationId: input.conversationId,
    rootAgentRunId: analysisId,
    motion: input.message,
    targetSymbol: input.targetSymbol ?? null,
    userDebateRole: input.initialUserRole ?? "neutral",
  });
  db.close();
  persistSseEvent({ analysisId, type: "debate.started", payload: { debateSessionId: sessionId, speaker: "orchestrator", stance: "neutral", turnType: "opening", publicSummary: input.message } });
  return runRound({ userId: input.userId, debateSessionId: sessionId, analysisId, content: input.message, userRole: input.initialUserRole ?? "neutral", targetSymbol: input.targetSymbol ?? null, roundIndex: 1, runners, evidenceCall });
}

export async function continueDebate(input: {
  userId: string;
  debateSessionId: string;
  content: string;
  userRole?: DebateUserRole;
  runners?: DebateRunners;
  evidenceCall?: EvidenceCall;
}) {
  const runners = input.runners ?? defaultRunners;
  const evidenceCall = input.evidenceCall ?? buildDebateEvidenceBoard;
  const db = getDatabase();
  const session = db.prepare("SELECT * FROM debate_sessions WHERE id=? AND user_id=? AND status='active'").get(input.debateSessionId, input.userId) as Record<string, unknown> | undefined;
  if (!session) { db.close(); throw new Error("Debate not found"); }
  const roundIndex = Number(session.current_round_index ?? 0) + 1;
  db.close();
  return runRound({ userId: input.userId, debateSessionId: input.debateSessionId, analysisId: String(session.root_agent_run_id), content: input.content, userRole: input.userRole ?? String(session.user_debate_role) as DebateUserRole, targetSymbol: session.target_symbol ? String(session.target_symbol) : null, roundIndex, runners, evidenceCall });
}

async function runRound(input: {
  userId: string;
  debateSessionId: string;
  analysisId: string;
  content: string;
  userRole: DebateUserRole;
  targetSymbol: string | null;
  roundIndex: number;
  runners: DebateRunners;
  evidenceCall: EvidenceCall;
}) {
  const plan = DebateRoundPlanSchema.parse(await input.runners.plan(roundPlanPrompt(input.content, input.userRole)));
  const db = getDatabase();
  const roundId = createDebateRound(db, { debateSessionId: input.debateSessionId, roundIndex: input.roundIndex, roundFocus: plan.roundFocus, userIntent: plan.userIntent });
  db.prepare("UPDATE debate_sessions SET user_debate_role=?,motion=?,updated_at=? WHERE id=?").run(plan.userDebateRole, plan.motion, isoNow(), input.debateSessionId);
  db.close();
  persistSseEvent({ analysisId: input.analysisId, type: "debate.round.started", payload: { debateSessionId: input.debateSessionId, roundId, speaker: "orchestrator", stance: "neutral", turnType: "opening", publicSummary: plan.roundFocus } });
  persistUserTurn(input.analysisId, input.debateSessionId, roundId, input.content, plan.userDebateRole);

  const board = await input.evidenceCall({ userId: input.userId, debateSessionId: input.debateSessionId, rootAgentRunId: input.analysisId, motion: plan.motion, targetSymbol: input.targetSymbol, userClaims: [input.content] });
  persistTurn(input.analysisId, input.debateSessionId, roundId, "evidence", "neutral", "evidence_update", evidenceSummary(board), { board });

  const bull = AdvocateSpeechSchema.parse(await input.runners.advocate("bull", advocatePrompt("bull", input.content, plan, board)));
  persistTurn(input.analysisId, input.debateSessionId, roundId, "bull", "bull", plan.userDebateRole === "bull" ? "support" : "opening", bull.plainLanguageSummary, bull);

  const bear = AdvocateSpeechSchema.parse(await input.runners.advocate("bear", advocatePrompt("bear", input.content, plan, board, bull)));
  persistTurn(input.analysisId, input.debateSessionId, roundId, "bear", "bear", plan.userDebateRole === "bear" ? "support" : "rebuttal", bear.plainLanguageSummary, bear);

  let bullReply: AdvocateSpeech | null = null;
  if (plan.userDebateRole === "bull") {
    bullReply = AdvocateSpeechSchema.parse(await input.runners.advocate("bull", advocatePrompt("bull", input.content, plan, board, bear)));
    persistTurn(input.analysisId, input.debateSessionId, roundId, "bull", "bull", "answer", bullReply.plainLanguageSummary, bullReply);
  }

  const judgement = DebateJudgementSchema.parse(await input.runners.judge(judgePrompt(input.content, plan, board, bull, bear, bullReply)));
  const judgeDb = getDatabase();
  createDebateJudgement(judgeDb, { debateSessionId: input.debateSessionId, debateRoundId: roundId, ...judgement });
  judgeDb.prepare("UPDATE agent_runs SET status='completed',completed_at=?,output_summary=?,result_json=? WHERE id=?")
    .run(isoNow(), judgement.keyDisagreement, json({ debateSessionId: input.debateSessionId, roundId, judgement }), input.analysisId);
  judgeDb.close();
  persistTurn(input.analysisId, input.debateSessionId, roundId, "judge", "neutral", "judge_summary", judgement.whyNotFinal, judgement);
  persistSseEvent({ analysisId: input.analysisId, type: "debate.round.completed", payload: { debateSessionId: input.debateSessionId, roundId, speaker: "judge", stance: "neutral", turnType: "judge_summary", publicSummary: judgement.whyNotFinal } });
  return { debateSessionId: input.debateSessionId, roundId, roundIndex: input.roundIndex, analysis: { analysisId: input.analysisId, type: "DEBATE", status: "COMPLETED", streamUrl: `/api/v1/debates/${input.debateSessionId}/events` }, judgement };
}

function persistUserTurn(analysisId: string, debateSessionId: string, roundId: string, content: string, userRole: DebateUserRole): void {
  const stance = userRole === "bull" ? "bull" : userRole === "bear" ? "bear" : "neutral";
  const db = getDatabase();
  createDebateTurn(db, { debateSessionId, debateRoundId: roundId, speaker: "user", stance, turnType: "support", content, publicSummary: content.slice(0, 240), structuredPayload: { userRole } });
  db.close();
  persistSseEvent({ analysisId, type: "debate.turn.completed", payload: { debateSessionId, roundId, speaker: "user", stance, turnType: "support", publicSummary: content.slice(0, 240) } });
}

function persistTurn(analysisId: string, debateSessionId: string, roundId: string, speaker: "evidence" | "bull" | "bear" | "judge", stance: "bull" | "bear" | "neutral", turnType: "evidence_update" | "opening" | "support" | "rebuttal" | "answer" | "judge_summary", publicSummary: string, structuredPayload: Record<string, unknown>): void {
  const turn = DebateTurnSchema.parse({ speaker, stance, turnType, content: publicSummary, publicSummary, structuredPayload });
  const db = getDatabase();
  createDebateTurn(db, { ...turn, debateSessionId, debateRoundId: roundId });
  db.close();
  persistSseEvent({ analysisId, type: speaker === "judge" ? "debate.judge.completed" : speaker === "evidence" ? "debate.evidence.completed" : "debate.agent.completed", payload: { debateSessionId, roundId, speaker, stance, turnType, publicSummary } });
}

function roundPlanPrompt(content: string, role: DebateUserRole): string {
  return [`用户消息：${content}`, `用户身份：${role}`, "请生成本轮多空 Battle 计划，重点让理财小白能参与。"].join("\n");
}

function advocatePrompt(stance: "bull" | "bear", content: string, plan: DebateRoundPlan, board: DebateEvidenceBoard, opponent?: AdvocateSpeech): string {
  return JSON.stringify({ stance, userMessage: content, plan, evidenceBoard: board, opponent }, null, 2);
}

function judgePrompt(content: string, plan: DebateRoundPlan, board: DebateEvidenceBoard, bull: AdvocateSpeech, bear: AdvocateSpeech, bullReply: AdvocateSpeech | null): string {
  return JSON.stringify({ userMessage: content, plan, evidenceBoard: board, bull, bear, bullReply }, null, 2);
}

function evidenceSummary(board: DebateEvidenceBoard): string {
  const facts = [...board.profileFacts, ...board.portfolioFacts, ...board.marketFacts].slice(0, 4);
  return facts.length ? `共同事实：${facts.join("；")}` : "共同事实不足，裁判需按证据不足处理。";
}
```

- [ ] **Step 4: Run service tests and typecheck**

Run:

```bash
pnpm vitest run src/server/extensions/debate/service.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/extensions/debate/service.ts src/server/extensions/debate/service.test.ts
git commit -m "feat: orchestrate debate rounds"
```

---

### Task 6: Debate API And SSE Routes

**Files:**
- Create: `src/app/api/v1/debates/route.ts`
- Create: `src/app/api/v1/debates/route.test.ts`
- Create: `src/app/api/v1/debates/[id]/turns/route.ts`
- Create: `src/app/api/v1/debates/[id]/route.ts`
- Create: `src/app/api/v1/debates/[id]/events/route.ts`

- [ ] **Step 1: Write create-route test**

Create `src/app/api/v1/debates/route.test.ts`:

```typescript
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authenticatedRequest, seedAuthenticatedUser, TEST_USER_ID } from "@tests/helpers/auth";
import { getDatabase } from "@/server/http/context";
import { POST } from "./route";

vi.mock("@/server/extensions/debate/service", () => ({
  startDebate: vi.fn(async () => ({
    debateSessionId: "debate_mock",
    roundId: "debate_round_mock",
    roundIndex: 1,
    analysis: {
      analysisId: "analysis_mock",
      type: "DEBATE",
      status: "COMPLETED",
      streamUrl: "/api/v1/debates/debate_mock/events",
    },
    judgement: {
      userClaim: "用户询问是否加仓。",
      bullStrongestPoint: "多方提出估值修复。",
      bearStrongestPoint: "空方提出趋势风险。",
      keyDisagreement: "估值是否足够便宜。",
      responseQuality: { bull: "direct", bear: "direct" },
      evidenceTilt: "balanced",
      confidence: 0.55,
      whyNotFinal: "缺少更多证据。",
      suggestedNextPrompts: ["让多方解释估值是否真的便宜"],
      complianceNote: "仅用于研究和模拟。",
    },
  })),
}));

let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-debate-route-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
  seedAuthenticatedUser();
  const db = getDatabase();
  db.prepare("INSERT INTO conversation_sessions (id,user_id,title,status,created_at,updated_at,row_version) VALUES ('conversation_debate',?,'Battle','active','2026-07-25T00:00:00.000Z','2026-07-25T00:00:00.000Z',1)").run(TEST_USER_ID);
  db.prepare("INSERT INTO instruments (id,symbol,name,market,asset_type,tradable) VALUES ('instrument_510300','510300.OF','沪深300ETF','OF','ETF',1)").run();
  db.close();
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
});

describe("POST /api/v1/debates", () => {
  it("requires an idempotency key", async () => {
    const res = await POST(authenticatedRequest("http://localhost/api/v1/debates", { method: "POST", body: JSON.stringify({ conversationId: "conversation_debate", message: "是否加仓 510300？" }) }));
    expect(res.status).toBe(400);
  });

  it("starts a debate", async () => {
    const res = await POST(authenticatedRequest("http://localhost/api/v1/debates", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "debate-create-1" },
      body: JSON.stringify({ conversationId: "conversation_debate", message: "是否加仓 510300？", targetSymbol: "510300.OF", initialUserRole: "neutral" }),
    }));
    const body = await res.json();
    expect(res.status).toBe(202);
    expect(body.data.debateSessionId).toBe("debate_mock");
  });
});
```

- [ ] **Step 2: Run route test and verify it fails**

Run:

```bash
pnpm vitest run src/app/api/v1/debates/route.test.ts
```

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Add create debate route**

Create `src/app/api/v1/debates/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { startDebate } from "@/server/extensions/debate/service";
import { beginIdempotentRequest, parseIdempotentResponse, saveIdempotentResponse } from "@/server/extensions/middleware/idempotency";
import { getRequestContext, idempotencyKey, meta } from "@/server/http/context";

const Schema = z.object({
  conversationId: z.string().min(1),
  message: z.string().min(1).max(4000),
  targetSymbol: z.string().max(32).optional(),
  initialUserRole: z.enum(["neutral", "bull", "bear"]).default("neutral"),
});

export async function POST(req: NextRequest) {
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid debate request", details: parsed.error.format() } }, { status: 422 });
  const key = idempotencyKey(req);
  if (!key) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Idempotency-Key required" } }, { status: 400 });
  const { userId } = getRequestContext(req);
  const idem = await beginIdempotentRequest(userId, "debate_create", key, parsed.data);
  if (idem.existing?.conflict) return NextResponse.json({ error: { code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key was already used with a different request" } }, { status: 409 });
  if (idem.existing) return NextResponse.json(parseIdempotentResponse(idem.existing), { status: 200 });
  try {
    const result = await startDebate({ userId, ...parsed.data });
    const payload = { data: result, meta: meta() };
    await saveIdempotentResponse(userId, "debate_create", key, idem.requestHash, payload);
    return NextResponse.json(payload, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Debate failed";
    const status = message === "Conversation not found" ? 404 : 502;
    return NextResponse.json({ error: { code: status === 404 ? "RESOURCE_NOT_FOUND" : "DEBATE_FAILED", message, retryable: status >= 500 } }, { status });
  }
}
```

- [ ] **Step 4: Add continue and detail routes**

Create `src/app/api/v1/debates/[id]/turns/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { continueDebate } from "@/server/extensions/debate/service";
import { beginIdempotentRequest, parseIdempotentResponse, saveIdempotentResponse } from "@/server/extensions/middleware/idempotency";
import { getRequestContext, idempotencyKey, meta } from "@/server/http/context";

const Schema = z.object({ content: z.string().min(1).max(4000), userRole: z.enum(["neutral", "bull", "bear"]).optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid debate turn", details: parsed.error.format() } }, { status: 422 });
  const key = idempotencyKey(req);
  if (!key) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Idempotency-Key required" } }, { status: 400 });
  const { userId } = getRequestContext(req);
  const routeCode = `debate_turn:${id}`;
  const idem = await beginIdempotentRequest(userId, routeCode, key, parsed.data);
  if (idem.existing?.conflict) return NextResponse.json({ error: { code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key was already used with a different request" } }, { status: 409 });
  if (idem.existing) return NextResponse.json(parseIdempotentResponse(idem.existing), { status: 200 });
  try {
    const result = await continueDebate({ userId, debateSessionId: id, ...parsed.data });
    const payload = { data: result, meta: meta() };
    await saveIdempotentResponse(userId, routeCode, key, idem.requestHash, payload);
    return NextResponse.json(payload, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Debate turn failed";
    const status = message === "Debate not found" ? 404 : 502;
    return NextResponse.json({ error: { code: status === 404 ? "RESOURCE_NOT_FOUND" : "DEBATE_TURN_FAILED", message, retryable: status >= 500 } }, { status });
  }
}
```

Create `src/app/api/v1/debates/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";

import { getDatabase, getRequestContext, meta, parseJson } from "@/server/http/context";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId } = getRequestContext(req);
  const db = getDatabase();
  const session = db.prepare("SELECT * FROM debate_sessions WHERE id=? AND user_id=?").get(id, userId) as Record<string, unknown> | undefined;
  if (!session) { db.close(); return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Debate not found" } }, { status: 404 }); }
  const rounds = db.prepare("SELECT * FROM debate_rounds WHERE debate_session_id=? ORDER BY round_index").all(id) as Array<Record<string, unknown>>;
  const turns = db.prepare("SELECT * FROM debate_turns WHERE debate_session_id=? ORDER BY created_at,id").all(id) as Array<Record<string, unknown>>;
  db.close();
  return NextResponse.json({
    data: {
      ...session,
      rounds: rounds.map((round) => ({ ...round, judgeSummary: round.judge_summary_json ? parseJson(String(round.judge_summary_json), null) : null })),
      turns: turns.map((turn) => ({ ...turn, structuredPayload: parseJson(String(turn.structured_payload_json ?? "{}"), {}) })),
    },
    meta: meta(),
  });
}
```

Create `src/app/api/v1/debates/[id]/events/route.ts`:

```typescript
import { NextRequest } from "next/server";

import { getSseEvents } from "@/server/extensions/sse/event-persister";
import { getDatabase, getRequestContext } from "@/server/http/context";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId } = getRequestContext(req);
  const db = getDatabase();
  const session = db.prepare("SELECT root_agent_run_id FROM debate_sessions WHERE id=? AND user_id=?").get(id, userId) as { root_agent_run_id?: string } | undefined;
  db.close();
  if (!session?.root_agent_run_id) return Response.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Debate not found" } }, { status: 404 });
  const events = getSseEvents(session.root_agent_run_id, req.headers.get("Last-Event-ID"));
  const body = events.map((event) => {
    const data = JSON.stringify({ ...event.payload, analysisId: event.analysisId, createdAt: event.createdAt });
    return `id: ${event.id}\nevent: ${event.type}\ndata: ${data}\n\n`;
  }).join("");
  return new Response(body || ": connected\n\n", { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
}
```

- [ ] **Step 5: Run route tests and typecheck**

Run:

```bash
pnpm vitest run src/app/api/v1/debates/route.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/debates/route.ts src/app/api/v1/debates/route.test.ts src/app/api/v1/debates/[id]/turns/route.ts src/app/api/v1/debates/[id]/route.ts src/app/api/v1/debates/[id]/events/route.ts
git commit -m "feat: add debate api routes"
```

---

### Task 7: Debate Evidence Pack And Chief Advisor Handoff

**Files:**
- Create: `src/app/api/v1/debates/[id]/evidence-pack/route.ts`
- Modify: `src/server/extensions/debate/service.ts`
- Create: `src/app/api/v1/debates/[id]/evidence-pack/route.test.ts`

- [ ] **Step 1: Write evidence-pack route test**

Create `src/app/api/v1/debates/[id]/evidence-pack/route.test.ts`:

```typescript
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authenticatedRequest, seedAuthenticatedUser, TEST_USER_ID } from "@tests/helpers/auth";
import { getDatabase } from "@/server/http/context";
import { GET } from "./route";

let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-debate-pack-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
  seedAuthenticatedUser();
  const db = getDatabase();
  db.prepare("INSERT INTO conversation_sessions (id,user_id,title,status,created_at,updated_at,row_version) VALUES ('conversation_debate',?,'Battle','active','2026-07-25T00:00:00.000Z','2026-07-25T00:00:00.000Z',1)").run(TEST_USER_ID);
  db.prepare("INSERT INTO agent_runs (id,user_id,type,status,session_id,created_at) VALUES ('analysis_debate',?,'debate_agent','completed','conversation_debate','2026-07-25T00:00:00.000Z')").run(TEST_USER_ID);
  db.prepare("INSERT INTO debate_sessions (id,user_id,conversation_id,root_agent_run_id,motion,user_debate_role,status,current_round_index,created_at,updated_at) VALUES ('debate_1',?,'conversation_debate','analysis_debate','是否加仓','neutral','active',1,'2026-07-25T00:00:00.000Z','2026-07-25T00:00:00.000Z')").run(TEST_USER_ID);
  db.prepare("INSERT INTO debate_rounds (id,debate_session_id,round_index,round_focus,user_intent,status,created_at,completed_at) VALUES ('round_1','debate_1',1,'估值 vs 趋势','ask_both','completed','2026-07-25T00:00:00.000Z','2026-07-25T00:00:01.000Z')").run();
  db.prepare("INSERT INTO debate_turns (id,debate_session_id,debate_round_id,speaker,stance,turn_type,content,public_summary,structured_payload_json,created_at) VALUES ('turn_bull','debate_1','round_1','bull','bull','opening','多方观点','多方摘要','{}','2026-07-25T00:00:00.000Z')").run();
  db.prepare("INSERT INTO debate_judgements (id,debate_session_id,debate_round_id,user_claim,bull_strongest_point,bear_strongest_point,key_disagreement,response_quality_json,evidence_tilt,confidence_decimal,why_not_final,suggested_next_prompts_json,compliance_note,created_at) VALUES ('judge_1','debate_1','round_1','用户想加仓','多方强点','空方强点','关键分歧','{"bull":"direct","bear":"direct"}','balanced','0.55','还缺证据','["继续追问"]','仅研究','2026-07-25T00:00:01.000Z')").run();
  db.close();
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
});

describe("GET /api/v1/debates/:id/evidence-pack", () => {
  it("returns debate rounds, turns, and judgement", async () => {
    const res = await GET(authenticatedRequest("http://localhost/api/v1/debates/debate_1/evidence-pack"), { params: Promise.resolve({ id: "debate_1" }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.turns[0].speaker).toBe("bull");
    expect(body.data.judgements[0].evidenceTilt).toBe("balanced");
  });
});
```

- [ ] **Step 2: Run evidence-pack test and verify it fails**

Run:

```bash
pnpm vitest run src/app/api/v1/debates/[id]/evidence-pack/route.test.ts
```

Expected: FAIL because evidence-pack route does not exist.

- [ ] **Step 3: Add evidence-pack route**

Create `src/app/api/v1/debates/[id]/evidence-pack/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";

import { getSseEvents } from "@/server/extensions/sse/event-persister";
import { getDatabase, getRequestContext, meta, parseJson } from "@/server/http/context";

type Row = Record<string, unknown>;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId } = getRequestContext(req);
  const db = getDatabase();
  const session = db.prepare("SELECT * FROM debate_sessions WHERE id=? AND user_id=?").get(id, userId) as Row | undefined;
  if (!session) { db.close(); return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Debate not found" } }, { status: 404 }); }
  const rounds = db.prepare("SELECT * FROM debate_rounds WHERE debate_session_id=? ORDER BY round_index").all(id) as Row[];
  const turns = db.prepare("SELECT * FROM debate_turns WHERE debate_session_id=? ORDER BY created_at,id").all(id) as Row[];
  const judgements = db.prepare("SELECT * FROM debate_judgements WHERE debate_session_id=? ORDER BY created_at,id").all(id) as Row[];
  const agentRuns = db.prepare("SELECT * FROM agent_runs WHERE user_id=? AND (id=? OR root_run_id=?) ORDER BY created_at,id").all(userId, session.root_agent_run_id, session.root_agent_run_id) as Row[];
  const evidence = db.prepare(`SELECT ei.* FROM evidence_items ei JOIN agent_runs ar ON ar.id=ei.agent_run_id
    WHERE ei.user_id=? AND (ar.id=? OR ar.root_run_id=?) ORDER BY ei.created_at,ei.id`).all(userId, session.root_agent_run_id, session.root_agent_run_id) as Row[];
  db.close();
  return NextResponse.json({
    data: {
      debateSessionId: id,
      motion: session.motion,
      status: String(session.status).toUpperCase(),
      rounds: rounds.map((round) => ({ id: round.id, roundIndex: round.round_index, roundFocus: round.round_focus, userIntent: round.user_intent, status: String(round.status).toUpperCase(), judgeSummary: round.judge_summary_json ? parseJson(String(round.judge_summary_json), null) : null })),
      turns: turns.map((turn) => ({ id: turn.id, roundId: turn.debate_round_id, speaker: turn.speaker, stance: turn.stance, turnType: turn.turn_type, content: turn.content, publicSummary: turn.public_summary, structuredPayload: parseJson(String(turn.structured_payload_json ?? "{}"), {}) })),
      judgements: judgements.map((item) => ({ id: item.id, roundId: item.debate_round_id, userClaim: item.user_claim, bullStrongestPoint: item.bull_strongest_point, bearStrongestPoint: item.bear_strongest_point, keyDisagreement: item.key_disagreement, responseQuality: parseJson(String(item.response_quality_json), {}), evidenceTilt: item.evidence_tilt, confidence: Number(item.confidence_decimal), whyNotFinal: item.why_not_final, suggestedNextPrompts: parseJson(String(item.suggested_next_prompts_json), []), complianceNote: item.compliance_note })),
      agentTrace: agentRuns.map((run) => ({ id: run.id, agent: run.agent_type ?? run.type, status: String(run.status).toUpperCase(), summary: run.output_summary ?? null, failure: run.failure_code ? { code: run.failure_code, message: run.failure_message } : null })),
      evidence: evidence.map((item) => ({ id: item.id, kind: item.kind, stance: item.stance, title: item.title, summary: item.statement ?? item.summary, quality: item.quality })),
      events: getSseEvents(String(session.root_agent_run_id)).map((event) => ({ id: event.id, type: event.type, payload: event.payload, createdAt: event.createdAt })),
      disclaimer: "多空 Battle 用于投资研究和方案模拟，不代表未来收益，不构成交易指令。",
    },
    meta: meta(),
  });
}
```

- [ ] **Step 4: Add final handoff function in debate service**

Modify `src/server/extensions/debate/service.ts` by adding an exported function that prepares a Chief Advisor prompt but keeps implementation behind the existing advisor service:

```typescript
export function buildDebateChiefAdvisorPrompt(input: {
  motion: string;
  turns: Array<{ speaker: string; publicSummary: string }>;
  judgements: DebateJudgement[];
}): string {
  return [
    `辩题：${input.motion}`,
    `公开发言摘要：${JSON.stringify(input.turns.slice(-12))}`,
    `裁判总结：${JSON.stringify(input.judgements.slice(-3))}`,
    "请基于多空 Battle 的公开证据和裁判总结，生成模拟建议或阻断原因。不得将任一方胜负直接变成交易指令。",
  ].join("\n");
}
```

Add a unit test to `src/server/extensions/debate/service.test.ts`:

```typescript
import { buildDebateChiefAdvisorPrompt } from "./service";

it("builds a publication-gate handoff prompt", () => {
  const prompt = buildDebateChiefAdvisorPrompt({
    motion: "是否加仓 510300",
    turns: [{ speaker: "bull", publicSummary: "多方认为估值修复值得验证" }],
    judgements: [{ userClaim: "用户想加仓", bullStrongestPoint: "估值修复", bearStrongestPoint: "趋势风险", keyDisagreement: "估值是否便宜", responseQuality: { bull: "direct", bear: "direct" }, evidenceTilt: "balanced", confidence: 0.55, whyNotFinal: "缺证据", suggestedNextPrompts: ["继续追问"], complianceNote: "仅研究" }],
  });
  expect(prompt).toContain("不得将任一方胜负直接变成交易指令");
});
```

- [ ] **Step 5: Run evidence-pack and service tests**

Run:

```bash
pnpm vitest run src/app/api/v1/debates/[id]/evidence-pack/route.test.ts src/server/extensions/debate/service.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/debates/[id]/evidence-pack/route.ts src/app/api/v1/debates/[id]/evidence-pack/route.test.ts src/server/extensions/debate/service.ts src/server/extensions/debate/service.test.ts
git commit -m "feat: expose debate evidence pack"
```

---

### Task 8: Final Verification

**Files:**
- Verify only; no planned edits.

- [ ] **Step 1: Run targeted debate tests**

Run:

```bash
pnpm vitest run \
  src/server/extensions/debate/contracts.test.ts \
  src/server/extensions/debate/persistence.test.ts \
  src/server/extensions/debate/evidence.test.ts \
  src/server/extensions/debate/service.test.ts \
  src/mastra/agents/debate-agents.test.ts \
  src/app/api/v1/debates/route.test.ts \
  src/app/api/v1/debates/[id]/evidence-pack/route.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run regression tests around existing advisor and SSE**

Run:

```bash
pnpm vitest run \
  src/app/api/v1/conversations/[id]/messages/route.test.ts \
  src/app/api/v1/analyses/[id]/events/route.test.ts \
  src/server/extensions/pandadata/adapter.test.ts \
  src/server/extensions/simulation/scenario-agent.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run typecheck and lint**

Run:

```bash
pnpm typecheck
pnpm lint
```

Expected: PASS.

- [ ] **Step 4: Inspect changed files**

Run:

```bash
git diff --stat HEAD~8..HEAD
git diff --check HEAD~8..HEAD
```

Expected: `git diff --check` produces no whitespace errors. The diff should show only debate-related files plus `event-persister.ts` and `core.ts`.

- [ ] **Step 5: Commit any verification-only fixes**

If Step 3 or Step 4 required small fixes, commit them:

```bash
git add <fixed-files>
git commit -m "fix: polish debate agent implementation"
```

If no fixes were required, do not create an empty commit.

---

## Self-Review

- Spec coverage: The plan covers dedicated debate state, user neutral/standing modes, Bull/Bear/Judge/Orchestrator agents, evidence board reuse, SSE events, API routes, evidence pack, and Chief Advisor handoff.
- Scope control: Frontend rendering is explicitly excluded. The plan exposes backend routes, stream events, and evidence-pack data for the separate frontend implementer.
- Test coverage: Unit tests cover contracts, persistence, agent coercion, evidence building, and service orchestration. Route tests cover creation and evidence pack. Regression tests protect existing advisor/SSE paths.
