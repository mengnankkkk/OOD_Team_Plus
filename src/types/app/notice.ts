export type AlertSeverity = "info" | "watch" | "important" | "urgent";
export type AlertStatus = "unread" | "read" | "dismissed" | "actioned";

export interface Alert {
  id: string;
  recommendationId: string | null;
  goalId: string | null;
  sourceType: string;
  sourceId: string | null;
  severity: AlertSeverity;
  title: string;
  message: string | null;
  status: AlertStatus;
  dataAsOf: string | null;
  occurrenceCount: number;
  version: number;
  metadata: {
    rule?: string;
    symbol?: string;
    name?: string;
    metricValue?: number;
    threshold?: number;
    advisorPrompt?: string;
    dataQuality?: string;
    [key: string]: unknown;
  };
  createdAt: string;
}

export interface AlertSyncState {
  status: "idle" | "running" | "succeeded" | "partial" | "failed";
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastMarketRefreshAt: string | null;
  dataAsOf: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export type DecisionAction = "viewed" | "followup_question" | "simulated" | "revoked" | "rejected" | "later" | "commented";

export interface DecisionLog {
  id: string;
  recommendationId: string | null;
  action: DecisionAction;
  reason: string | null;
  agentSnapshot: Record<string, unknown>;
  createdAt: string;
}
