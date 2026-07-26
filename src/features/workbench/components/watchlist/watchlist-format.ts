type Availability = "available" | "stale" | "insufficient_data";

type ConditionLike = {
  conditionType: string;
  threshold: string;
  thresholdDate: string | null;
  windowDays: number | null;
};

const conditionLabels: Record<string, string> = {
  PRICE_ABOVE: "价格高于",
  PRICE_BELOW: "价格低于",
  DRAWDOWN_REACH: "回撤达到",
  DAILY_MOVE_REACH: "单日涨跌达到",
  POSITION_WEIGHT_ABOVE: "持仓权重高于",
  UNREALIZED_GAIN_REACH: "浮盈达到",
  REVIEW_DATE: "复查日期",
};

export function formatAvailability(status: Availability): string {
  if (status === "available") return "可用";
  if (status === "stale") return "数据较旧";
  return "数据不足";
}

export function formatPercentRatio(value: number | null, maximumFractionDigits = 2): string {
  if (value == null || !Number.isFinite(value)) return "数据不足";
  return new Intl.NumberFormat("zh-CN", {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(value);
}

export function formatMoney(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "数据不足";
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatDateTime(value: string | null): string {
  if (!value) return "暂无";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function conditionSummary(condition: ConditionLike): string {
  if (condition.conditionType === "REVIEW_DATE") {
    return `在 ${condition.thresholdDate ?? "未设置日期"} 复查`;
  }
  if (condition.conditionType === "PRICE_ABOVE" || condition.conditionType === "PRICE_BELOW") {
    return `${conditionLabels[condition.conditionType]} ${formatMoney(Number(condition.threshold))}`;
  }
  const threshold = formatPercentRatio(Number(condition.threshold));
  if (condition.conditionType === "DRAWDOWN_REACH") {
    return `近 ${condition.windowDays ?? 20} 日回撤达到 ${threshold}`;
  }
  return `${conditionLabels[condition.conditionType] ?? condition.conditionType} ${threshold}`;
}

export function conditionTypeLabel(type: string): string {
  return conditionLabels[type] ?? type;
}
