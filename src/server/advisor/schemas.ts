import { z } from "zod";

import {
  recommendationActionSchema,
  recommendationStatusSchema,
} from "@/server/advisor/types";

const shortList = z.array(z.string().trim().min(1).max(240)).max(3);
const requiredCounterEvidence = z.array(z.string().trim().min(1).max(240)).min(1).max(3);
const specialistAgentRoleSchema = z.enum([
  "profile",
  "data_research",
  "portfolio_risk",
  "recommendation",
  "compliance",
]);

export const advisorAgentFindingSchema = z.object({
  role: specialistAgentRoleSchema,
  intent: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(600),
  missingInformation: z.array(z.string().trim().min(1).max(120)).max(8),
  supportEvidence: shortList,
  counterEvidence: requiredCounterEvidence,
  risks: shortList,
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  needsAnotherAgent: z.boolean(),
  suggestedNextAgent: specialistAgentRoleSchema.optional(),
});

export const advisorDecisionSchema = z.object({
  action: recommendationActionSchema,
  status: recommendationStatusSchema,
  primaryInstrument: z.object({
    symbol: z.string().trim().min(1).max(40),
    name: z.string().trim().max(120).optional(),
  }).optional(),
  summary: z.string().trim().min(1).max(800),
  suitability: z.enum(["LOW", "MEDIUM", "HIGH"]),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  rationales: shortList.min(1),
  counterEvidence: requiredCounterEvidence,
  risks: shortList.min(1),
  suggestedAllocationRange: z.string().trim().min(1).max(80),
  firstEntryAllocation: z.string().trim().min(1).max(80),
  addConditions: z.array(z.string().trim().min(1).max(180)).min(1).max(4),
  referenceRange: z.string().trim().min(1).max(120),
  stopLoss: z.string().trim().min(1).max(160),
  takeProfit: z.string().trim().min(1).max(160),
  horizon: z.enum(["SHORT", "MEDIUM", "LONG"]),
  validUntil: z.string().trim().min(1).max(40),
  executionPace: z.string().trim().min(1).max(160),
  sellDownRatio: z.string().trim().min(1).max(80),
  triggerReasons: z.array(z.string().trim().min(1).max(160)).max(4),
  portfolioImpact: z.string().trim().min(1).max(240),
  alternatives: z.array(z.string().trim().min(1).max(160)).min(1).max(4),
  invalidationConditions: z.array(z.string().trim().min(1).max(180)).min(1).max(4),
  sourceSummary: z.string().trim().min(1).max(240),
  agentsConsulted: z.array(specialistAgentRoleSchema).min(2).max(8),
  compliance: z.object({
    approved: z.boolean(),
    decision: z.enum(["APPROVED", "DOWNGRADED", "BLOCKED"]),
    reason: z.string().trim().min(1).max(240),
  }),
});

export type AdvisorAgentFinding = z.infer<typeof advisorAgentFindingSchema>;
export type AdvisorDecision = z.infer<typeof advisorDecisionSchema>;
