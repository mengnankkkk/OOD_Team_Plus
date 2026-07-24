import { z } from "zod";

export const ProfessionalAgentRoleSchema = z.enum([
  "PROFILE_CONTEXT",
  "DATA_RESEARCH",
  "PORTFOLIO_RISK",
  "RECOMMENDATION",
  "COMPLIANCE_REVIEWER",
  "EXPLANATION_REPORT",
]);

export const AgentFindingSchema = z.object({
  agent: ProfessionalAgentRoleSchema,
  conclusion: z.string().min(1),
  supportEvidence: z.array(z.string()).max(3),
  counterEvidence: z.array(z.string()).min(1).max(3),
  missingInformation: z.array(z.string()).max(12),
  risks: z.array(z.string()).max(3),
  confidence: z.number().min(0).max(1),
  needsAnotherAgent: z.boolean().default(false),
  suggestedNextAgent: ProfessionalAgentRoleSchema.optional(),
});

export const AdvisorDecisionSchema = z.object({
  action: z.enum(["WATCH", "TRIAL_BUY", "SCALE_IN", "HOLD", "STOP_ADDING", "SCALE_OUT", "EXIT"]),
  requestedDirection: z.enum(["BUY", "SELL", "HOLD", "ANALYZE"]),
  summary: z.string().min(1),
  suitability: z.enum(["HIGH", "MEDIUM", "LOW"]),
  confidence: z.number().min(0).max(1),
  rationales: z.array(z.string()).min(1).max(3),
  counterEvidence: z.array(z.string()).min(1).max(3),
  risks: z.array(z.string()).min(1).max(3),
  portfolioImpact: z.string().min(1),
  invalidationConditions: z.array(z.string()).min(1).max(6),
  compliance: z.object({
    approved: z.boolean(),
    decision: z.enum(["APPROVED", "DOWNGRADED", "BLOCKED"]),
    reason: z.string().min(1),
  }),
});

export type AgentFinding = z.infer<typeof AgentFindingSchema>;
export type AdvisorDecision = z.infer<typeof AdvisorDecisionSchema>;
export type ProfessionalAgentRole = z.infer<typeof ProfessionalAgentRoleSchema>;
