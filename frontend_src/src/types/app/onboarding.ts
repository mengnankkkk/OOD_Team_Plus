export type TraceSpanKind = "tool" | "reasoning" | "io" | "llm";
export type TraceSpanStatus = "ok" | "error";

export interface TraceSpan {
  id: string;
  name: string;
  label: string;
  kind: TraceSpanKind;
  tool: string | null;
  input: unknown;
  output: unknown;
  startedAt: string;
  durationMs: number;
  status: TraceSpanStatus;
  note?: string;
}

export interface AdvisorTrace {
  id: string;
  startedAt: string;
  totalMs: number;
  model: string;
  spans: TraceSpan[];
  finalReply: string;
}

export interface OnboardingMessage {
  id: string;
  role: "user" | "advisor" | "system";
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  sessionId: string | null;
}

export interface AdvisorSessionSummary {
  sessionId: string;
  title: string;
  messageCount: number;
  lastActivityAt: string;
  firstActivityAt: string;
}

export interface AdvisorReply {
  reply: string;
  profileUpdate: Record<string, unknown> | null;
  trace: AdvisorTrace | null;
  sessionId: string;
}
