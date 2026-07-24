export type AlertSeverity = "info" | "watch" | "important" | "urgent";
export type AlertStatus = "unread" | "read" | "dismissed" | "actioned";

export interface Alert {
  id: string;
  recommendationId: string | null;
  goalId: string | null;
  severity: AlertSeverity;
  title: string;
  message: string | null;
  status: AlertStatus;
  createdAt: string;
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
