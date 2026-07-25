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

export class A2APublicError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
