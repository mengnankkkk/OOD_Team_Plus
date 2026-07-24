export type RiskLevel = "R1" | "R2" | "R3" | "R4" | "R5";

export type RiskQuestionOption = {
  value: string;
  label: string;
  score: number;
};

export type RiskQuestion = {
  id: string;
  dimension: "CAPACITY" | "EXPERIENCE" | "ATTITUDE" | "LIQUIDITY";
  prompt: string;
  helper?: string;
  options: RiskQuestionOption[];
};

export const RISK_QUESTIONNAIRE_VERSION = 2;

// The structure mirrors common suitability questionnaires: financial capacity,
// investment knowledge/experience, loss tolerance, and liquidity needs.
export const RISK_QUESTIONS: RiskQuestion[] = [
  {
    id: "financial_stability",
    dimension: "CAPACITY",
    prompt: "目前你的收入与现金流情况更接近哪一种？",
    helper: "请选择最近一年大多数时间的真实情况。",
    options: [
      { value: "surplus", label: "收入稳定，扣除日常支出后仍有明显结余", score: 5 },
      { value: "stable", label: "收入稳定，基本能够覆盖日常支出", score: 4 },
      { value: "tight", label: "收入和支出接近，偶尔需要动用储蓄", score: 2 },
      { value: "unstable", label: "收入波动较大或经常需要借款周转", score: 1 },
    ],
  },
  {
    id: "emergency_reserve",
    dimension: "CAPACITY",
    prompt: "你目前的应急资金，大约可以覆盖几个月的必要支出？",
    helper: "不含股票、基金等需要波动卖出的资产。",
    options: [
      { value: "over12", label: "12 个月以上", score: 5 },
      { value: "6to12", label: "6-12 个月", score: 4 },
      { value: "3to6", label: "3-6 个月", score: 3 },
      { value: "under3", label: "少于 3 个月或没有单独储备", score: 1 },
    ],
  },
  {
    id: "debt_burden",
    dimension: "CAPACITY",
    prompt: "你的负债和还款压力情况如何？",
    options: [
      { value: "none", label: "没有负债，或还款压力很低", score: 5 },
      { value: "manageable", label: "有房贷等长期负债，但月供压力可控", score: 4 },
      { value: "high", label: "负债较多，月供会明显影响投资安排", score: 2 },
      { value: "overburdened", label: "存在逾期、借贷周转或较大的短期还款压力", score: 1 },
    ],
  },
  {
    id: "investment_experience",
    dimension: "EXPERIENCE",
    prompt: "你的投资经验更接近哪一种？",
    options: [
      { value: "advanced", label: "投资过股票、行业基金或衍生品，能独立理解风险", score: 5 },
      { value: "some", label: "投资过股票或基金，了解基本的波动和回撤", score: 4 },
      { value: "fund", label: "主要买过存款、货币基金或低波动理财", score: 3 },
      { value: "none", label: "几乎没有投资经验", score: 1 },
    ],
  },
  {
    id: "investment_knowledge",
    dimension: "EXPERIENCE",
    prompt: "你对投资产品和风险指标的了解程度如何？",
    options: [
      { value: "high", label: "能看懂估值、波动、回撤，并能比较不同产品", score: 5 },
      { value: "basic", label: "了解基金、股票的基本概念，但需要解释专业指标", score: 3 },
      { value: "limited", label: "只了解少量基础知识，通常依赖他人建议", score: 2 },
      { value: "none", label: "基本不了解，希望从简单的方案开始", score: 1 },
    ],
  },
  {
    id: "holding_horizon",
    dimension: "LIQUIDITY",
    prompt: "这笔准备投资的钱，最早什么时候可能需要使用？",
    options: [
      { value: "over5", label: "5 年以后，期间基本不需要动用", score: 5 },
      { value: "3to5", label: "3-5 年内可能使用", score: 4 },
      { value: "1to3", label: "1-3 年内可能使用", score: 3 },
      { value: "under1", label: "一年内就可能需要使用", score: 1 },
    ],
  },
  {
    id: "loss_reaction",
    dimension: "ATTITUDE",
    prompt: "如果投资组合短期下跌 20%，你更可能怎么做？",
    options: [
      { value: "add", label: "确认基本面没有变化后，考虑分批增加", score: 5 },
      { value: "hold", label: "继续持有，等待市场恢复", score: 4 },
      { value: "reduce", label: "先减仓一部分，降低心理压力", score: 2 },
      { value: "sell", label: "大部分或全部卖出，避免继续下跌", score: 1 },
    ],
  },
  {
    id: "max_drawdown",
    dimension: "ATTITUDE",
    prompt: "在不影响生活和目标的前提下，你能接受多大的阶段性回撤？",
    options: [
      { value: "over30", label: "30% 以上", score: 5 },
      { value: "20to30", label: "20%-30%", score: 4 },
      { value: "10to20", label: "10%-20%", score: 3 },
      { value: "under10", label: "10% 以内", score: 1 },
    ],
  },
  {
    id: "near_term_use",
    dimension: "LIQUIDITY",
    prompt: "未来 12 个月内，你是否有确定的大额用款计划？",
    options: [
      { value: "not_needed", label: "没有，资金可以长期投资", score: 5 },
      { value: "maybe", label: "可能有，但时间和金额都不确定", score: 3 },
      { value: "needed", label: "有明确计划，需要保留较高流动性", score: 1 },
    ],
  },
];

const RISK_LABELS: Record<RiskLevel, string> = {
  R1: "保守型",
  R2: "谨慎型",
  R3: "稳健型",
  R4: "成长型",
  R5: "进取型",
};

const EQUITY_WEIGHTS: Record<RiskLevel, number> = {
  R1: 0.2,
  R2: 0.4,
  R3: 0.6,
  R4: 0.8,
  R5: 1,
};

const levelForScore = (score: number): RiskLevel => {
  if (score <= 15) return "R1";
  if (score <= 22) return "R2";
  if (score <= 29) return "R3";
  if (score <= 37) return "R4";
  return "R5";
};

const levelRank = (level: RiskLevel) => Number(level.slice(1));

export type RiskAssessmentResult = {
  riskLevel: RiskLevel;
  riskLabel: string;
  score: number;
  capacityScore: number;
  willingnessScore: number;
  capacityLevel: RiskLevel;
  willingnessLevel: RiskLevel;
  recommendedMaxEquityWeight: number;
  conflicts: string[];
  missingQuestionIds: string[];
};

export function evaluateRiskAssessment(answers: Record<string, string>): RiskAssessmentResult {
  const missingQuestionIds = RISK_QUESTIONS
    .filter((question) => !answers[question.id] || !question.options.some((option) => option.value === answers[question.id]))
    .map((question) => question.id);

  const scoreOf = (question: RiskQuestion) => question.options.find((option) => option.value === answers[question.id])?.score ?? 0;
  const score = RISK_QUESTIONS.reduce((total, question) => total + scoreOf(question), 0);
  const capacityQuestions = RISK_QUESTIONS.filter((question) => question.dimension === "CAPACITY" || question.id === "holding_horizon" || question.id === "near_term_use");
  const willingnessQuestions = RISK_QUESTIONS.filter((question) => question.dimension === "EXPERIENCE" || question.dimension === "ATTITUDE");
  const capacityScore = capacityQuestions.reduce((total, question) => total + scoreOf(question), 0);
  const willingnessScore = willingnessQuestions.reduce((total, question) => total + scoreOf(question), 0);
  const capacityLevel = levelForScore(Math.round((capacityScore / (capacityQuestions.length * 5)) * 45));
  const willingnessLevel = levelForScore(Math.round((willingnessScore / (willingnessQuestions.length * 5)) * 45));
  const overallLevel = levelForScore(score);
  const riskLevel = levelRank(capacityLevel) < levelRank(willingnessLevel) ? capacityLevel : overallLevel;
  const conflicts: string[] = [];

  if (levelRank(capacityLevel) + 1 < levelRank(willingnessLevel)) {
    conflicts.push("你的投资意愿高于当前现金流和流动性承受能力，建议先保留应急金，再逐步增加高波动资产。");
  }
  if (levelRank(willingnessLevel) + 1 < levelRank(capacityLevel)) {
    conflicts.push("你的财务条件允许更高波动，但主观风险偏好偏低，建议以低波动和分批投入为主。");
  }

  return {
    riskLevel,
    riskLabel: RISK_LABELS[riskLevel],
    score,
    capacityScore,
    willingnessScore,
    capacityLevel,
    willingnessLevel,
    recommendedMaxEquityWeight: EQUITY_WEIGHTS[riskLevel],
    conflicts,
    missingQuestionIds,
  };
}

export function horizonFromAnswer(value: string | undefined): "SHORT" | "MEDIUM" | "LONG" {
  if (value === "under1") return "SHORT";
  if (value === "1to3") return "MEDIUM";
  return "LONG";
}

export function maxDrawdownFromAnswer(value: string | undefined): string {
  if (value === "under10") return "0.10";
  if (value === "10to20") return "0.20";
  if (value === "20to30") return "0.30";
  return "0.40";
}
