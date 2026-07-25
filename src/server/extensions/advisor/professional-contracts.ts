import { z } from "zod";

const NonEmptyTextSchema = z.string().trim().min(1);

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

export const DebateSuggestionSchema = z.object({
  recommended: z.boolean(),
  motion: NonEmptyTextSchema.max(240),
  reason: NonEmptyTextSchema.max(500),
  targetSymbol: z.string().trim().min(1).max(64).nullable().optional(),
});

export const AdvisorDecisionSchema = z.object({
  action: z.enum(["WATCH", "TRIAL_BUY", "SCALE_IN", "HOLD", "STOP_ADDING", "SCALE_OUT", "EXIT"]),
  requestedDirection: z.enum(["BUY", "SELL", "HOLD", "ANALYZE"]),
  summary: NonEmptyTextSchema,
  suitability: z.enum(["HIGH", "MEDIUM", "LOW"]),
  confidence: z.number().min(0).max(1),
  rationales: z.array(NonEmptyTextSchema).min(1).max(3),
  counterEvidence: z.array(NonEmptyTextSchema).min(1).max(3),
  risks: z.array(NonEmptyTextSchema).min(1).max(3),
  portfolioImpact: NonEmptyTextSchema,
  invalidationConditions: z.array(NonEmptyTextSchema).min(1).max(6),
  compliance: z.object({
    approved: z.boolean(),
    decision: z.enum(["APPROVED", "DOWNGRADED", "BLOCKED"]),
    reason: NonEmptyTextSchema,
  }),
  debateSuggestion: DebateSuggestionSchema,
});

export function attachTrustedTargetSymbol(
  suggestion: DebateSuggestion,
  trustedTargetSymbol?: string | null,
): DebateSuggestion {
  const baseSuggestion: DebateSuggestion = {
    recommended: suggestion.recommended,
    motion: suggestion.motion,
    reason: suggestion.reason,
  };
  if (!baseSuggestion.recommended) return baseSuggestion;
  return {
    ...baseSuggestion,
    targetSymbol: trustedTargetSymbol?.trim() || null,
  };
}

export type AgentFinding = z.infer<typeof AgentFindingSchema>;
export type AdvisorDecision = z.infer<typeof AdvisorDecisionSchema>;
export type DebateSuggestion = z.infer<typeof DebateSuggestionSchema>;
export type ProfessionalAgentRole = z.infer<typeof ProfessionalAgentRoleSchema>;
