export type RecommendationAction = "increase" | "decrease" | "hold" | "observe" | "emergency_reserve";
export type RecommendationStatus = "active" | "simulated" | "revoked" | "expired" | "rejected";

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
}

export interface EvidencePack {
  id: string;
  recommendationId: string | null;
  agentRunId: string | null;
  dataSnapshots: unknown[];
  skillRuns: { skill: string; status: string; latencyMs: number }[];
  workflowDag: {
    nodes: { id: string; label: string; status: string; durationMs: number; summary: string }[];
    edges: { from: string; to: string }[];
  };
  researchMetrics: Record<string, unknown>;
  simulationLog: Record<string, unknown>[];
  riskVerdicts: { rule: string; verdict: string; target?: string; note?: string }[];
  createdAt: string;
}
