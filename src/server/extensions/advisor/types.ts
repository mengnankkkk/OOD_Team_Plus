export type ConversationOutputMode = "SQL_ONLY" | "CHART" | "FINANCIAL_REPORT";

export interface AdvisorRunInput {
  userId: string;
  sessionId: string;
  content: string;
  outputMode?: ConversationOutputMode;
  clientMessageId?: string;
}

export interface ProfileRow extends Record<string, unknown> {
  status?: string;
  risk_level?: string;
  investment_amount_decimal?: string;
  horizon?: string;
  max_drawdown_decimal?: string;
}

export interface AdvisorHolding extends Record<string, unknown> {
  instrument_id: string;
  symbol: string;
  name: string;
  quantity_decimal: string;
  cost_decimal: string;
  price_decimal: string;
  market_value_decimal: string;
  unrealized_pnl_decimal: string;
  weight_bps: number;
}

export interface AdvisorInstrument extends Record<string, unknown> {
  id: string;
  symbol: string;
  name: string;
  latest_price: string | null;
}

export interface AdvisorContext {
  profile: ProfileRow | null;
  goals: Array<Record<string, unknown>>;
  snapshot: Record<string, unknown> | null;
  holdings: AdvisorHolding[];
  instruments: AdvisorInstrument[];
}

export interface RecommendationDraft {
  instrumentId: string;
  symbol: string;
  action: "WATCH" | "TRIAL_BUY" | "SCALE_IN" | "HOLD" | "STOP_ADDING" | "SCALE_OUT" | "EXIT";
  suitability: "HIGH" | "MEDIUM" | "LOW";
  summary: string;
  confidence: string;
  positionRange: string[];
  firstPosition: string | null;
  addConditions: string[];
  referenceRange: string[];
  stopLoss: string;
  takeProfit: string;
  horizon: "SHORT" | "MEDIUM" | "LONG";
  expiresAt: string;
  reasons: string[];
  counterEvidence: string[];
  risks: string[];
  alternatives: string[];
  invalidation: string;
  compliance: { status: "PASSED" | "DEGRADED" | "BLOCKED"; reasons: string[]; disclaimer: string };
  dataAsOf: string;
  provenance: Record<string, unknown>;
}
