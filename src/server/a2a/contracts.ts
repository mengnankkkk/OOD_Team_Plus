import { z } from "zod";

export const A2A_CAPABILITIES = [
  "chief_advisor_conversation",
  "debate_mode",
  "scenario_simulation",
  "research_search",
  "tasks_read",
  "tasks_cancel",
] as const;

export type A2ACapability = (typeof A2A_CAPABILITIES)[number];

export type ExternalClientView = {
  id: string;
  name: string;
  status: "ACTIVE" | "DISABLED";
  capabilities: A2ACapability[];
  rateLimitPerMinute: number;
  tokenPrefix: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type ExternalClientPrincipal = {
  clientId: string;
  name: string;
  capabilities: A2ACapability[];
  rateLimitPerMinute: number;
};

export const CapabilityIdSchema = z.enum([
  "chief_advisor_conversation",
  "debate_mode",
  "scenario_simulation",
  "research_search",
]);

const DecimalSchema = z.string().regex(/^\d+(?:\.\d+)?$/u);

export const ExternalProfileSchema = z.object({
  riskLevel: z.string().trim().max(40).optional(),
  investmentAmount: DecimalSchema.optional(),
  horizon: z.string().trim().max(80).optional(),
  maxDrawdown: z.string().regex(/^0(?:\.\d+)?$|^1(?:\.0+)?$/u).optional(),
}).strict();

export const ExternalGoalSchema = z.object({
  name: z.string().trim().min(1).max(200),
  targetAmount: DecimalSchema,
  targetDate: z.string().date().optional(),
  horizon: z.string().trim().min(1).max(80),
  priority: z.string().trim().min(1).max(40),
  assetPreference: z.string().trim().max(200).optional(),
}).strict();

export const ExternalHoldingSchema = z.object({
  symbol: z.string().trim().min(1).max(32),
  quantity: DecimalSchema,
  cost: DecimalSchema,
}).strict();

export const ExternalPortfolioSchema = z.object({
  cash: DecimalSchema,
  holdings: z.array(ExternalHoldingSchema).min(1).max(100),
}).strict();

export type CapabilityId = z.infer<typeof CapabilityIdSchema>;
export type CapabilityFamily = "ADVISORY" | "SIMULATION" | "RESEARCH";
export type ExternalProfile = z.infer<typeof ExternalProfileSchema>;
export type ExternalGoal = z.infer<typeof ExternalGoalSchema>;
export type ExternalPortfolio = z.infer<typeof ExternalPortfolioSchema>;

export function capabilityFamily(capabilityId: CapabilityId): CapabilityFamily {
  if (capabilityId === "chief_advisor_conversation" || capabilityId === "debate_mode") return "ADVISORY";
  return capabilityId === "scenario_simulation" ? "SIMULATION" : "RESEARCH";
}

export type A2AContextView = {
  id: string;
  externalClientId: string;
  executionUserId: string;
  primaryCapability: CapabilityId;
  status: "ACTIVE" | "COMPLETED" | "ARCHIVED" | "EXPIRED";
  profile: ExternalProfile;
  goals: ExternalGoal[];
  portfolioInput: ExternalPortfolio | null;
  portfolioSnapshotId: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

export type A2ATaskStatus =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "canceled"
  | "failed";

export type A2AArtifact = {
  artifactId: string;
  name: string;
  text: string;
  data: Record<string, unknown>;
};

export type A2ATaskResult = {
  message: string;
  artifacts: A2AArtifact[];
  metadata?: Record<string, unknown>;
};

export type PublicA2AError = {
  code: string;
  message: string;
  status: number;
  retryable?: boolean;
  details?: Record<string, unknown>;
};

export type A2ATaskView = {
  id: string;
  externalClientId: string;
  contextId: string;
  capabilityId: CapabilityId;
  operation: string;
  status: A2ATaskStatus;
  domainResourceType: string | null;
  domainResourceId: string | null;
  result: A2ATaskResult | null;
  error: PublicA2AError | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  events: Array<{ sequenceNo: number; eventType: string; payload: unknown; createdAt: string }>;
};

export type CapabilityAdapterInput = {
  principal: ExternalClientPrincipal;
  task: A2ATaskView;
  context: A2AContextView;
  messageId: string;
  text: string;
  operation: string;
  input: Record<string, unknown>;
  acceptedOutputModes: string[];
};

export type CapabilityCancellationInput = {
  principal: ExternalClientPrincipal;
  task: A2ATaskView;
};

export type CapabilityAdapter = {
  run(input: CapabilityAdapterInput): Promise<A2ATaskView>;
  cancel?(input: CapabilityCancellationInput): Promise<void> | void;
};

export type A2ACommand =
  | {
      kind: "send-message";
      requestId: string | number | null;
      payload: {
        messageId: string;
        contextId: string | null;
        text: string;
        capabilityId: CapabilityId;
        operation: string;
        input: Record<string, unknown>;
        acceptedOutputModes: string[];
      };
    }
  | { kind: "get-task"; requestId: string | number | null; taskId: string }
  | { kind: "list-tasks"; requestId: string | number | null; cursor?: string; limit: number }
  | { kind: "cancel-task"; requestId: string | number | null; taskId: string };

export class A2APublicError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
