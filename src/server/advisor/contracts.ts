import { z } from "zod";

import { DEMO_SEED_VERSION } from "@/server/advisor/seed";

const money = z.string().regex(/^[0-9]+(?:\.[0-9]{1,4})?$/);
const ratio = z.number().min(0).max(1);
const horizon = z.enum(["SHORT", "MEDIUM", "LONG"]);
const preferences = z.array(
  z.enum(["STOCK", "SECTOR_ETF", "BROAD_INDEX_ETF", "INDEX_FUND", "GOLD", "CASH"]),
).max(8);

export const profilePatchSchema = z.object({
  investableCapital: money.optional(),
  monthlyContribution: money.optional(),
  monthlyExpenses: money.optional(),
  nearTermCashNeed: money.optional(),
  nearTermLiquidityNeed: money.optional(),
  subjectiveRiskPreference: z.enum(["CONSERVATIVE", "BALANCED", "AGGRESSIVE"]).optional(),
  instrumentPreferences: preferences.optional(),
  notes: z.string().max(2_000).optional(),
});

export const riskAssessmentSchema = z.object({
  questionnaireVersion: z.string().default("risk-v1"),
  answers: z.array(z.object({ questionId: z.string(), value: z.string() })).min(2),
  objectiveInputs: z.object({
    incomeStability: z.enum(["STABLE", "VARIABLE", "UNCERTAIN"]),
    investmentAssetShareOfHouseholdAssets: ratio,
    hasEmergencyFund: z.boolean(),
  }),
});

export const profileCompleteSchema = z.object({
  riskAssessmentId: z.string(),
  acknowledgements: z.object({
    informationIsAccurate: z.literal(true),
    understandsSimulationOnly: z.literal(true),
  }),
});

export const goalCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  goalType: z.string().optional(),
  targetAmount: money,
  initialInvestmentAmount: money.default("0"),
  monthlyContributionAmount: money.default("0"),
  horizon,
  targetDate: z.string().date().optional(),
  priority: z.number().int().min(1).max(100).default(1),
  instrumentPreferences: preferences.default([]),
  capitalPreservationRequired: z.boolean().default(false),
  notes: z.string().max(1_000).optional(),
});

export const goalPatchSchema = goalCreateSchema.partial();

export const holdingCreateSchema = z.object({
  instrumentId: z.string().optional(),
  assetType: z.string().optional(),
  symbol: z.string().optional(),
  name: z.string().optional(),
  market: z.string().default("CN"),
  quantity: money,
  averageCost: money,
  currency: z.string().default("CNY"),
  acquiredAt: z.string().date().optional(),
  goalId: z.string().optional(),
  purpose: z.string().optional(),
  plannedHorizon: horizon.optional(),
  thesis: z.string().max(1_000).optional(),
});

export const holdingPatchSchema = holdingCreateSchema
  .pick({ quantity: true, averageCost: true, thesis: true })
  .partial();

export const holdingParseSchema = z.object({
  text: z.string().trim().min(1).max(2_000),
  defaultMarket: z.string().default("CN"),
  conversationId: z.string().optional(),
});

export const holdingConfirmSchema = z.object({
  confirmedCandidates: z.array(holdingCreateSchema.extend({
    candidateId: z.string(),
    instrumentId: z.string().nullable().optional(),
    assetType: z.string().nullable().optional(),
    symbol: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
  })).min(1).max(10),
});

export const conversationCreateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  mode: z.enum(["ONBOARDING", "ADVISORY", "DIAGNOSIS", "FOLLOW_UP"]).default("ADVISORY"),
});

export const conversationPatchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  status: z.enum(["ACTIVE", "ARCHIVED", "COMPLETED"]).optional(),
});

const flatMessageSchema = z.object({
  clientMessageId: z.string().max(120).optional(),
  content: z.string().trim().min(1).max(4_000),
  responseMode: z.enum(["STREAM", "SYNC"]).default("STREAM"),
});

export const advisorConversationMessageSchema = z.union([
  flatMessageSchema,
  z.object({ message: z.object({ content: z.string().trim().min(1).max(4_000) }) }),
]).transform((value) => "message" in value
  ? { content: value.message.content, responseMode: "STREAM" as const }
  : value);

export const clarificationAnswerSchema = z.object({
  answers: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

export const analysisCreateSchema = z.object({
  type: z.enum([
    "ADVISORY_QA",
    "STOCK_DIAGNOSTIC",
    "PORTFOLIO_DIAGNOSTIC",
    "HOLDING_REVIEW",
    "STOCK_SUITABILITY_SCREEN",
  ]),
  conversationId: z.string(),
  input: z.record(z.string(), z.unknown()).default({}),
});

export const simulationCreateSchema = z.object({
  scenario: z.enum(["PROPOSED", "NO_ACTION", "ALTERNATIVE"]).default("PROPOSED"),
  customAdjustment: z.record(z.string(), z.unknown()).nullable().default(null),
});

export const decisionCreateSchema = z.object({
  action: z.enum(["SIMULATED_ACCEPT", "REJECT", "DEFER", "ASK_FOLLOW_UP"]),
  simulationId: z.string().nullable().default(null),
  reasonCodes: z.array(z.string()).max(10).default([]),
  note: z.string().max(1_000).optional(),
});

export const watchConditionCreateSchema = z.object({
  recommendationId: z.string().optional(),
  instrumentId: z.string().optional(),
  type: z.enum([
    "PRICE_ENTER_ZONE",
    "DRAWDOWN_REACH",
    "PE_PERCENTILE_BELOW",
    "MACD_CONFIRMATION",
    "EVENT_RISK",
    "POSITION_WEIGHT_ABOVE",
    "THESIS_INVALIDATED",
    "REVIEW_DATE",
  ]),
  severity: z.enum(["INFO", "IMPORTANT", "URGENT"]).default("IMPORTANT"),
  parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  validUntil: z.string().datetime().optional(),
});

export const watchConditionPatchSchema = watchConditionCreateSchema
  .pick({ severity: true, parameters: true })
  .partial()
  .extend({ status: z.enum(["ACTIVE", "PAUSED", "CANCELLED"]).optional() });

export const watchEvaluateSchema = z.object({
  conditionIds: z.array(z.string()).optional(),
  createConversationMessages: z.boolean().default(false),
});

export const watchlistCreateSchema = z.object({
  instrumentId: z.string(),
  note: z.string().max(500).optional(),
});

export const watchlistPatchSchema = z.object({
  note: z.string().max(500).nullable().optional(),
});

export const demoResetSchema = z.object({
  seedVersion: z.literal(DEMO_SEED_VERSION),
});
