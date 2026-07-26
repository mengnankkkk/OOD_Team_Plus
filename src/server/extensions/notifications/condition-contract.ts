import { z } from "zod";

export const CONDITION_TYPES = [
  "PRICE_ABOVE",
  "PRICE_BELOW",
  "DRAWDOWN_REACH",
  "DAILY_MOVE_REACH",
  "POSITION_WEIGHT_ABOVE",
  "UNREALIZED_GAIN_REACH",
  "REVIEW_DATE",
] as const;

export const CONDITION_SEVERITIES = ["INFORMATION", "ATTENTION", "IMPORTANT", "URGENT"] as const;
export const CONDITION_STATUSES = ["ACTIVE", "PAUSED"] as const;

export type ObservationConditionType = (typeof CONDITION_TYPES)[number];

export const CreateConditionSchema = z.object({
  watchlistItemId: z.string().trim().min(1),
  conditionType: z.enum(CONDITION_TYPES),
  threshold: z.string().trim().optional(),
  thresholdDate: z.iso.date().optional(),
  windowDays: z.number().int().min(5).max(120).optional(),
  severity: z.enum(CONDITION_SEVERITIES).default("ATTENTION"),
}).superRefine(validateConditionInput);

export const PatchConditionSchema = z.object({
  threshold: z.string().trim().optional(),
  thresholdDate: z.iso.date().nullable().optional(),
  windowDays: z.number().int().min(5).max(120).nullable().optional(),
  severity: z.enum(CONDITION_SEVERITIES).optional(),
  status: z.enum(CONDITION_STATUSES).optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one field is required");

export function normalizeCondition(input: {
  conditionType: ObservationConditionType;
  threshold?: string;
  thresholdDate?: string | null;
  windowDays?: number | null;
}): { threshold: string; thresholdDate: string | null; windowDays: number | null } {
  const issues: string[] = [];
  validateValues(input, (message) => issues.push(message));
  if (issues.length) throw new Error(issues[0]);
  if (input.conditionType === "REVIEW_DATE") {
    return { threshold: "0", thresholdDate: input.thresholdDate!, windowDays: null };
  }
  return {
    threshold: normalizeDecimal(input.threshold!),
    thresholdDate: null,
    windowDays: input.conditionType === "DRAWDOWN_REACH" ? input.windowDays ?? 20 : null,
  };
}

function validateConditionInput(
  value: {
    conditionType: ObservationConditionType;
    threshold?: string;
    thresholdDate?: string;
    windowDays?: number;
  },
  context: z.RefinementCtx,
): void {
  validateValues(value, (message, path) => {
    context.addIssue({ code: "custom", path: [path ?? "conditionType"], message });
  });
}

function validateValues(
  value: {
    conditionType: ObservationConditionType;
    threshold?: string;
    thresholdDate?: string | null;
    windowDays?: number | null;
  },
  issue: (message: string, path?: "threshold" | "thresholdDate" | "windowDays" | "conditionType") => void,
): void {
  if (value.conditionType === "REVIEW_DATE") {
    if (!value.thresholdDate) issue("复查日期不能为空", "thresholdDate");
    if (value.threshold !== undefined || value.windowDays != null) {
      issue("复查日期规则不接受数值阈值或窗口", "conditionType");
    }
    return;
  }

  const threshold = Number(value.threshold);
  if (!Number.isFinite(threshold)) {
    issue("请输入有效阈值", "threshold");
    return;
  }
  if (["DRAWDOWN_REACH", "DAILY_MOVE_REACH", "POSITION_WEIGHT_ABOVE", "UNREALIZED_GAIN_REACH"].includes(value.conditionType)
    && (threshold <= 0 || threshold > 1)) {
    issue("比例阈值必须大于 0 且不超过 1", "threshold");
  }
  if ((value.conditionType === "PRICE_ABOVE" || value.conditionType === "PRICE_BELOW") && threshold <= 0) {
    issue("价格阈值必须大于 0", "threshold");
  }
  if (value.thresholdDate != null) {
    issue("当前规则不接受复查日期", "thresholdDate");
  }
  if (value.conditionType === "DRAWDOWN_REACH") {
    if (value.windowDays != null && (value.windowDays < 5 || value.windowDays > 120)) {
      issue("回撤窗口必须在 5 到 120 日之间", "windowDays");
    }
  } else if (value.windowDays != null) {
    issue("当前规则不接受窗口参数", "windowDays");
  }
}

function normalizeDecimal(value: string): string {
  const normalized = Number(value);
  return Number.isInteger(normalized) ? String(normalized) : String(normalized);
}
