import { z } from "zod";

const decimalString = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/u, "必须是非负十进制数字");
const positiveDecimalString = decimalString.refine((value) => Number(value) > 0, "必须大于 0");

export const BranchScenarioTradeSchema = z.object({
  instrumentId: z.string().min(1).max(120),
  action: z.enum(["BUY", "SELL"]),
  quantity: positiveDecimalString,
}).strict();

const BranchScenarioOptionBaseSchema = z.object({
  label: z.string().min(1).max(120),
  description: z.string().min(1).max(800),
  strategy: z.enum(["HOLD", "BALANCED", "DEFENSIVE", "GROWTH"]),
  trades: z.array(BranchScenarioTradeSchema).max(30),
  targetAllocations: z.array(z.object({
    instrumentId: z.string().min(1).max(120),
    weight: decimalString,
  }).strict()).max(50),
  rationale: z.array(z.string().min(1)).min(1).max(3),
  counterEvidence: z.array(z.string().min(1)).min(1).max(3),
  risks: z.array(z.string().min(1)).min(1).max(3),
  assumptions: z.array(z.string().min(1)).min(1).max(8),
  invalidationConditions: z.array(z.string().min(1)).min(1).max(6),
});

export const BranchScenarioOptionSchema = BranchScenarioOptionBaseSchema.superRefine((option, context) => {
  const directions = new Set<string>();
  for (const trade of option.trades) {
    const key = `${trade.instrumentId}:${trade.action}`;
    if (directions.has(key)) {
      context.addIssue({
        code: "custom",
        path: ["trades"],
        message: `同一标的不能重复提交同方向交易：${key}`,
      });
    }
    directions.add(key);
  }
});

export const BranchScenarioPlanSchema = z.object({
  provider: z.enum(["CHIEF_ADVISOR", "DETERMINISTIC_FALLBACK"]),
  options: z.array(BranchScenarioOptionSchema).min(1).max(5),
  delegatedAgents: z.array(z.string().min(1).max(80)).max(12),
  modelSummary: z.string().max(1000).optional(),
}).strict();

const BranchScenarioModelTradeSchema = z.object({
  instrumentId: z.string().min(1).max(120).nullish(),
  instrument_id: z.string().min(1).max(120).nullish(),
  symbol: z.string().min(1).max(120).nullish(),
  ticker: z.string().min(1).max(120).nullish(),
  action: z.string().max(40).nullish(),
  side: z.string().max(40).nullish(),
  direction: z.string().max(40).nullish(),
  quantity: z.union([decimalString, z.number().finite()]).nullish(),
  qty: z.union([decimalString, z.number().finite()]).nullish(),
  amount: z.union([decimalString, z.number().finite()]).nullish(),
}).passthrough();

export const BranchScenarioModelOptionDraftSchema = z.object({
  description: z.string().min(1).max(800).nullish(),
  summary: z.string().min(1).max(800).nullish(),
  name: z.string().min(1).max(120).nullish(),
  strategy: z.string().max(80).nullish(),
  mode: z.string().max(80).nullish(),
  trades: z.array(BranchScenarioModelTradeSchema).max(30).nullish(),
  transactions: z.array(BranchScenarioModelTradeSchema).max(30).nullish(),
  targetAllocations: z.array(z.object({
    instrumentId: z.string().min(1).max(120).nullish(),
    instrument_id: z.string().min(1).max(120).nullish(),
    symbol: z.string().min(1).max(120).nullish(),
    weight: z.union([decimalString, z.number().finite()]).nullish(),
    targetWeight: z.union([decimalString, z.number().finite()]).nullish(),
  }).passthrough()).max(50).nullish(),
  rationale: z.union([z.string(), z.array(z.string().min(1)).max(3)]).nullish(),
  counterEvidence: z.union([z.string(), z.array(z.string().min(1)).max(3)]).nullish(),
  risks: z.union([z.string(), z.array(z.string().min(1)).max(3)]).nullish(),
  assumptions: z.union([z.string(), z.array(z.string().min(1)).max(8)]).nullish(),
  invalidationConditions: z.union([z.string(), z.array(z.string().min(1)).max(6)]).nullish(),
}).passthrough();

export const BranchScenarioModelPlanSchema = z.object({
  options: z.array(BranchScenarioModelOptionDraftSchema).max(5).nullish(),
  candidates: z.array(BranchScenarioModelOptionDraftSchema).max(5).nullish(),
  scenarios: z.array(BranchScenarioModelOptionDraftSchema).max(5).nullish(),
  option: BranchScenarioModelOptionDraftSchema.nullish(),
  candidate: BranchScenarioModelOptionDraftSchema.nullish(),
  delegatedAgents: z.preprocess((value) => typeof value === "string" ? [value] : value ?? undefined, z.array(z.string().min(1).max(80)).max(12).default([])),
  agents: z.array(z.string().min(1).max(80)).max(12).nullish(),
  modelSummary: z.string().max(1000).nullish(),
  summary: z.string().max(1000).nullish(),
}).passthrough();

export const BranchScenarioContextSchema = z.object({
  objective: z.string().min(1).max(2000),
  profile: z.record(z.string(), z.unknown()).nullable(),
  snapshot: z.record(z.string(), z.unknown()),
  holdings: z.array(z.record(z.string(), z.unknown())),
  instruments: z.array(z.record(z.string(), z.unknown())),
  research: z.array(z.record(z.string(), z.unknown())),
  riskConstraints: z.record(z.string(), z.unknown()),
});

export type BranchScenarioTrade = z.infer<typeof BranchScenarioTradeSchema>;
export type BranchScenarioOption = z.infer<typeof BranchScenarioOptionSchema>;
export type BranchScenarioPlan = z.infer<typeof BranchScenarioPlanSchema>;
export type BranchScenarioModelTrade = {
  instrumentId?: string | null;
  action?: string | null;
  quantity?: string | number | null;
};
export type BranchScenarioModelOptionDraft = {
  description: string;
  strategy: string;
  trades: Array<{ instrumentId: string; action: "BUY" | "SELL"; quantity: string }>;
  targetAllocations: Array<{ instrumentId: string; weight: string }>;
  rationale: string[];
  counterEvidence: string[];
  risks: string[];
  assumptions: string[];
  invalidationConditions: string[];
};
export type BranchScenarioModelPlan = {
  options: BranchScenarioModelOptionDraft[];
  delegatedAgents: string[];
  modelSummary?: string;
};
export type BranchScenarioAgentInput = z.infer<typeof BranchScenarioContextSchema>;
