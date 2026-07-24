export const riskQuestionnaire = {
  version: "risk-v1",
  questions: [
    {
      id: "monthly_drop_10",
      type: "SINGLE_CHOICE",
      prompt: "投资账户一个月下跌 10%，你最可能怎么做？",
      options: [
        { value: "SELL_ALL", label: "立即卖出" },
        { value: "REDUCE", label: "减少部分仓位" },
        { value: "RESEARCH_FIRST", label: "先了解原因" },
        { value: "ADD_IF_VALID", label: "逻辑未变则分批加仓" },
      ],
    },
    {
      id: "fund_usage_time",
      type: "SINGLE_CHOICE",
      prompt: "这笔资金最早什么时候可能需要使用？",
      options: [
        { value: "WITHIN_3_MONTHS", label: "三个月内" },
        { value: "WITHIN_1_YEAR", label: "一年内" },
        { value: "AFTER_1_YEAR", label: "一年以后" },
      ],
    },
    {
      id: "single_stock_volatility",
      type: "SINGLE_CHOICE",
      prompt: "你是否能接受个股在短期内波动 20%？",
      options: [
        { value: "NO", label: "不能接受" },
        { value: "LIMITED", label: "只接受小仓位" },
        { value: "YES", label: "可以接受" },
      ],
    },
  ],
};

export function scoreRiskAssessment(input: {
  questionnaireVersion: string;
  answers: Array<{ questionId: string; value: string }>;
  objectiveInputs: {
    incomeStability: "STABLE" | "VARIABLE" | "UNCERTAIN";
    investmentAssetShareOfHouseholdAssets: number;
    hasEmergencyFund: boolean;
  };
}) {
  const answers = Object.fromEntries(input.answers.map((answer) => [answer.questionId, answer.value]));
  const subjectiveScore =
    scoreAnswer(answers.monthly_drop_10, { SELL_ALL: 15, REDUCE: 35, RESEARCH_FIRST: 65, ADD_IF_VALID: 85 }) +
    scoreAnswer(answers.single_stock_volatility, { NO: 15, LIMITED: 50, YES: 80 });
  const normalizedSubjective = Math.round(subjectiveScore / 2);
  const capacityScore =
    (input.objectiveInputs.incomeStability === "STABLE" ? 75 : input.objectiveInputs.incomeStability === "VARIABLE" ? 50 : 25) +
    (input.objectiveInputs.hasEmergencyFund ? 20 : 0) -
    Math.round(input.objectiveInputs.investmentAssetShareOfHouseholdAssets * 35) +
    (answers.fund_usage_time === "AFTER_1_YEAR" ? 20 : answers.fund_usage_time === "WITHIN_1_YEAR" ? 0 : -25);
  const normalizedCapacity = clamp(capacityScore, 0, 100);
  const subjectiveRiskPreference = riskLevel(normalizedSubjective);
  const objectiveRiskCapacity = capacityLevel(normalizedCapacity);
  const effectiveRiskLevel = conservativeLevel(subjectiveRiskPreference, objectiveRiskCapacity);
  const rules = riskLimits(effectiveRiskLevel);
  const conflictDetected = riskRank(subjectiveRiskPreference) > riskRank(objectiveToRisk(objectiveRiskCapacity));
  return {
    questionnaireVersion: input.questionnaireVersion,
    answers: input.answers,
    subjectiveScore: normalizedSubjective,
    capacityScore: normalizedCapacity,
    subjectiveRiskPreference,
    objectiveRiskCapacity,
    effectiveRiskLevel,
    liquidityNeedLevel: answers.fund_usage_time === "WITHIN_3_MONTHS" ? "high" : answers.fund_usage_time === "WITHIN_1_YEAR" ? "medium" : "low",
    conflictDetected,
    conflictSummary: conflictDetected ? "主观风险偏好高于客观承受能力，系统按更保守边界执行。" : null,
    ...rules,
  };
}

function scoreAnswer(value: string | undefined, scores: Record<string, number>) {
  return value ? scores[value] ?? 40 : 40;
}

function riskLevel(score: number) {
  return score < 40 ? "CONSERVATIVE" : score < 70 ? "BALANCED" : "AGGRESSIVE";
}

function capacityLevel(score: number) {
  return score < 40 ? "LOW" : score < 70 ? "MEDIUM" : "HIGH";
}

function objectiveToRisk(capacity: string) {
  return capacity === "LOW" ? "CONSERVATIVE" : capacity === "MEDIUM" ? "BALANCED" : "AGGRESSIVE";
}

function conservativeLevel(subjective: string, capacity: string) {
  const effective = Math.min(riskRank(subjective), riskRank(objectiveToRisk(capacity)));
  return effective === 0 ? "CONSERVATIVE" : effective === 1 ? "BALANCED" : "AGGRESSIVE";
}

function riskRank(level: string) {
  return level === "CONSERVATIVE" ? 0 : level === "BALANCED" ? 1 : 2;
}

function riskLimits(level: string) {
  if (level === "CONSERVATIVE") return { maxAcceptableDrawdown: 0.08, maxEquityWeight: 0.4, maxSinglePositionWeight: 0.06, maxSectorWeight: 0.18 };
  if (level === "AGGRESSIVE") return { maxAcceptableDrawdown: 0.25, maxEquityWeight: 0.85, maxSinglePositionWeight: 0.18, maxSectorWeight: 0.4 };
  return { maxAcceptableDrawdown: 0.15, maxEquityWeight: 0.65, maxSinglePositionWeight: 0.1, maxSectorWeight: 0.25 };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
