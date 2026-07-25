export type RecommendationAction = "increase" | "decrease" | "hold" | "observe" | "emergency_reserve";
export type RecommendationStatus = "active" | "degraded" | "blocked" | "simulated" | "revoked" | "expired" | "rejected";

export interface EvidenceRow {
  label: string;
  value: string;
  source: string;
}

export interface AgentState {
  status: "running" | "done" | "blocked" | "skipped";
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  summary?: string;
  detail?: unknown;
}

export interface Recommendation {
  id: string;
  userId: string;
  agentRunId: string | null;
  goalId: string | null;
  action: RecommendationAction;
  headline: string;
  targetSymbol: string | null;
  targetAssetClass: string | null;
  amount: number | null;
  weight: number | null;
  pace: string | null;
  driver: string;
  evidence: EvidenceRow[];
  counterEvidence: EvidenceRow[];
  effectiveUntil: string;
  expireCondition: string;
  riskImpact: Record<string, unknown>;
  complianceStatus: "approved" | "blocked" | "pending";
  complianceNotes: string | null;
  status: RecommendationStatus;
  createdAt: string;
}

export interface AgentRun {
  id: string;
  triggerType: string;
  status: "running" | "succeeded" | "failed" | "blocked" | "cancelled";
  plannerSummary: string | null;
  agentStates: Record<string, AgentState>;
  startedAt: string;
  completedAt: string | null;
  type?: string;
  agent?: string | null;
  recommendationId?: string | null;
  recommendationStatus?: string | null;
  evidenceCount?: number;
  missingEvidenceCount?: number;
  toolCount?: number;
  skillCount?: number;
  canRetry?: boolean;
  failure?: { code: string | null; message: string | null } | null;
}

export interface EvidencePack {
  id: string;
  analysisId: string;
  analysisType: string;
  status: string;
  recommendationId: string | null;
  agentRunId: string | null;
  dataFreshness: Record<string, unknown>;
  evidence: Array<Record<string, unknown>>;
  agentTrace: Array<Record<string, unknown>>;
  toolCalls: Array<Record<string, unknown>>;
  skillRuns: Array<Record<string, unknown>>;
  pandadataProbes: Array<Record<string, unknown>>;
  marketSnapshots: Array<Record<string, unknown>>;
  conflicts: Array<Record<string, unknown>>;
  recommendations: Array<Record<string, unknown>>;
  compliance: Record<string, unknown>;
  missingEvidence: string[];
  retry: { allowed: boolean; reason: string | null };
  disclaimer: string;
  dataSnapshots: unknown[];
  workflowDag: {
    nodes: { id: string; label: string; status: string; durationMs: number; summary: string }[];
    edges: { from: string; to: string }[];
  };
  researchMetrics: Record<string, unknown>;
  simulationLog: Record<string, unknown>[];
  debate?: {
    conclusion: string;
    bull: string[];
    bear: string[];
    source: string;
  };
  riskVerdicts: { rule: string; verdict: string; target?: string; note?: string }[];
  createdAt: string;
}
