import { advisorDatabase, openAdvisorDatabase, type AdvisorDatabase } from "@/server/advisor/database";
import { advisorEventHub } from "@/server/advisor/event-hub";
import { AnalysisStore } from "@/server/advisor/analysis-store";
import { ConversationStore } from "@/server/advisor/conversation-store";
import { DecisionStore } from "@/server/advisor/decision-store";
import { HoldingStore } from "@/server/advisor/holding-store";
import { ProfileStore } from "@/server/advisor/profile-store";
import { RunStore } from "@/server/advisor/run-store";
import { DEMO_USER_ID, seedAdvisorDemo } from "@/server/advisor/seed";
import { WatchlistStore } from "@/server/advisor/watchlist-store";
import { newId, nowIso, runValue, runWrite } from "@/server/advisor/store-common";
import type {
  AdvisorEventType,
  AdvisorRun,
  AdvisorRunStatus,
  EvidenceItem,
  RecommendationCard,
} from "@/server/advisor/types";

export class AdvisorStore {
  readonly profile: ProfileStore;
  readonly holdings: HoldingStore;
  readonly conversations: ConversationStore;
  readonly runs: RunStore;
  readonly analysis: AnalysisStore;
  readonly decisions: DecisionStore;
  readonly watchlist: WatchlistStore;

  constructor(readonly database: AdvisorDatabase = openAdvisorDatabase(":memory:"), seed = true) {
    this.profile = new ProfileStore(database);
    this.holdings = new HoldingStore(database);
    this.conversations = new ConversationStore(database);
    this.runs = new RunStore(database);
    this.analysis = new AnalysisStore(database);
    this.decisions = new DecisionStore(database);
    this.watchlist = new WatchlistStore(database);
    if (seed) seedAdvisorDemo(database);
  }

  userId() {
    return DEMO_USER_ID;
  }

  ensureConversation(conversationId: string) {
    const existing = runValue<{ id: string }>(
      this.database,
      "SELECT id FROM conversation_sessions WHERE id = ?",
      conversationId,
    );
    if (existing) return;
    const timestamp = nowIso();
    runWrite(
      this.database,
      `INSERT INTO conversation_sessions
       (id, user_id, title, mode, status, context_json, version, created_at, updated_at)
       VALUES (?, ?, ?, 'advisory', 'active', '{}', 1, ?, ?)`,
      conversationId,
      DEMO_USER_ID,
      "临时顾问会话",
      timestamp,
      timestamp,
    );
  }

  createRun(
    input: Omit<AdvisorRun, "id" | "status" | "summary" | "createdAt" | "completedAt" | "rootRunId"> & {
      rootRunId?: string;
      triggerMessageId?: string;
    },
  ) {
    this.ensureConversation(input.conversationId);
    return this.runs.createRun(input);
  }

  updateRun(
    runId: string,
    patch: {
      status: AdvisorRunStatus;
      summary?: string;
      stage?: string;
      errorCode?: string;
      errorMessage?: string;
    },
  ) {
    return this.runs.updateRun(runId, patch);
  }

  getRun(runId: string) {
    return this.runs.getRun(runId);
  }

  listRuns(rootRunId: string) {
    return this.runs.listRuns(rootRunId);
  }

  appendEvent(input: {
    analysisId: string;
    conversationId: string;
    type: AdvisorEventType;
    payload: Record<string, unknown>;
  }) {
    this.ensureConversation(input.conversationId);
    const event = this.runs.appendEvent(input);
    advisorEventHub.publish(event);
    return event;
  }

  listEvents(analysisId: string, afterEventId?: string | null) {
    return this.runs.listEvents(analysisId, afterEventId);
  }

  hasAnalysis(analysisId: string) {
    return this.runs.hasAnalysis(analysisId);
  }

  addEvidence(input: Omit<EvidenceItem, "id" | "createdAt">) {
    return this.runs.addEvidence(input);
  }

  listEvidence(analysisId: string) {
    return this.runs.listEvidence(analysisId);
  }

  saveRecommendation(input: Omit<RecommendationCard, "id" | "createdAt">) {
    return this.analysis.saveRecommendation({ ...input, userId: input.userId ?? DEMO_USER_ID });
  }

  getRecommendation(id: string) {
    return this.analysis.getRecommendation(id);
  }

  getRecommendationForAnalysis(analysisId: string) {
    return this.analysis.getRecommendationForAnalysis(analysisId);
  }

  listRecommendations(filters: { action?: string; status?: string } = {}) {
    return this.analysis.listRecommendations(DEMO_USER_ID, filters);
  }

  resetDemo() {
    seedAdvisorDemo(this.database, true);
  }

  recordDemoReset(seedVersion: string, status = "succeeded") {
    const id = newId("demo_reset");
    const timestamp = nowIso();
    runWrite(
      this.database,
      `INSERT INTO demo_reset_runs(id, user_id, seed_version, status, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      DEMO_USER_ID,
      seedVersion,
      status,
      timestamp,
      status === "succeeded" ? timestamp : null,
    );
    return { id, seedVersion, status: status.toUpperCase(), createdAt: timestamp };
  }
}

const globalStore = globalThis as typeof globalThis & { moneyWhispererAdvisorStore?: AdvisorStore };

export const advisorStore =
  globalStore.moneyWhispererAdvisorStore ?? new AdvisorStore(advisorDatabase);

if (process.env.NODE_ENV !== "production") globalStore.moneyWhispererAdvisorStore = advisorStore;
