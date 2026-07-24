import { z } from "zod";

export const advisorAgentRoleSchema = z.enum([
  "chief_advisor",
  "profile",
  "data_research",
  "portfolio_risk",
  "recommendation",
  "compliance",
]);

export const advisorRunStatusSchema = z.enum([
  "queued",
  "running",
  "waiting_user",
  "succeeded",
  "blocked",
  "failed",
  "cancelled",
  "interrupted",
]);

export const advisorEventTypeSchema = z.enum([
  "run.started",
  "stage.changed",
  "supervisor.plan",
  "agent.started",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "evidence.added",
  "agent.completed",
  "recommendation.created",
  "clarification.created",
  "simulation.completed",
  "decision.recorded",
  "watch.triggered",
  "run.completed",
  "run.blocked",
  "run.failed",
]);

export const recommendationActionSchema = z.enum([
  "WATCH",
  "TRIAL_BUY",
  "SCALE_IN",
  "HOLD",
  "STOP_ADDING",
  "SCALE_OUT",
  "EXIT",
]);

export const recommendationStatusSchema = z.enum([
  "ACTIVE",
  "DEGRADED",
  "BLOCKED",
  "EXPIRED",
  "SUPERSEDED",
]);

export const advisorMessageRequestSchema = z.object({
  message: z.object({
    content: z.string().trim().min(1).max(4_000),
  }),
});

export type AdvisorAgentRole = z.infer<typeof advisorAgentRoleSchema>;
export type AdvisorRunStatus = z.infer<typeof advisorRunStatusSchema>;
export type AdvisorEventType = z.infer<typeof advisorEventTypeSchema>;
export type RecommendationAction = z.infer<typeof recommendationActionSchema>;
export type RecommendationStatus = z.infer<typeof recommendationStatusSchema>;

export type StockResearchCard = {
  symbol: string;
  name: string;
  exchange: string;
  source: "pandadata" | "mixed" | "local_fixture";
  dataQuality: "HIGH" | "MEDIUM" | "LOW";
  dataAsOf: string;
  methods: string[];
  unavailableMethods: string[];
  market: Record<string, unknown>;
  valuation: Record<string, unknown>;
  fundamentals: Record<string, unknown>;
  industry: Record<string, unknown>;
  events: Array<Record<string, unknown>>;
  capitalAndFactors: Record<string, unknown>;
  coverage: Record<string, unknown>;
  supportEvidence: string[];
  counterEvidence: string[];
};

export type AdvisorRun = {
  id: string;
  conversationId: string;
  parentRunId: string | null;
  rootRunId: string;
  role: AdvisorAgentRole;
  objective: string;
  status: AdvisorRunStatus;
  stage?: string | null;
  summary: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type AdvisorEvent = {
  id: string;
  analysisId: string;
  conversationId: string;
  sequence: number;
  type: AdvisorEventType;
  occurredAt: string;
  payload: Record<string, unknown>;
};

export type EvidenceItem = {
  id: string;
  analysisId: string;
  stance: "support" | "counter" | "neutral" | "missing";
  kind: "user_input" | "market_fact" | "calculation" | "rule_hit" | "missing_data";
  summary: string;
  source: "user_input" | "pandadata" | "local_fixture" | "derived_engine" | "system";
  createdAt: string;
};

export type RecommendationCard = {
  id: string;
  userId?: string;
  analysisId: string;
  conversationId: string;
  portfolioSnapshotId?: string;
  instrumentId?: string;
  action: RecommendationAction;
  status: RecommendationStatus;
  summary: string;
  suitability: "LOW" | "MEDIUM" | "HIGH";
  confidence: "LOW" | "MEDIUM" | "HIGH";
  rationales: string[];
  counterEvidence: string[];
  risks: string[];
  validUntil: string;
  sourceSummary: string;
  suggestedAllocationRange?: string;
  firstEntryAllocation?: string;
  addConditions?: string[];
  referenceRange?: string;
  stopLoss?: string;
  takeProfit?: string;
  horizon?: "SHORT" | "MEDIUM" | "LONG";
  executionPace?: string;
  sellDownRatio?: string;
  triggerReasons?: string[];
  portfolioImpact?: string;
  alternatives?: string[];
  invalidationConditions?: string[];
  agentTrace?: Array<{ agent: AdvisorAgentRole; summary: string }>;
  stockResearch?: StockResearchCard[];
  degradationReasons?: Array<
    | "MODEL_UNAVAILABLE"
    | "PANDADATA_UNAVAILABLE"
    | "PANDADATA_STALE"
    | "COMPLIANCE_DOWNGRADED"
    | "ADVICE_DEGRADED"
  >;
  runtimeMode?: "MULTI_AGENT" | "DETERMINISTIC_FALLBACK";
  createdAt: string;
};
