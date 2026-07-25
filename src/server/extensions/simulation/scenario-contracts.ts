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
  instrumentId: z.string().min(1).max(120),
  action: z.enum(["BUY", "SELL"]),
  quantity: decimalString,
}).strict();

export const BranchScenarioModelPlanSchema = z.object({
  options: z.array(BranchScenarioOptionBaseSchema.omit({ label: true }).extend({
    trades: z.array(BranchScenarioModelTradeSchema).max(30),
  })).min(1).max(5),
  delegatedAgents: z.array(z.string().min(1).max(80)).max(12),
  modelSummary: z.string().max(1000).optional(),
}).strict();

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
export type BranchScenarioModelPlan = z.infer<typeof BranchScenarioModelPlanSchema>;
export type BranchScenarioAgentInput = z.infer<typeof BranchScenarioContextSchema>;
