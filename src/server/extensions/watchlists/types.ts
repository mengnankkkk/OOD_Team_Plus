export type WatchlistStatus = "active" | "archived" | "deleted";
export type WatchlistItemSource = "USER" | "AGENT" | "IMPORT";

export type CreateWatchlistItemInput = {
  instrumentId: string;
  reason?: string;
  plannedHorizon?: string;
  goalId?: string | null;
  source: WatchlistItemSource;
  initialDrawdownThresholdPct?: number | null;
};

export type WatchlistSummary = {
  id: string;
  name: string;
  description: string | null;
  status: WatchlistStatus;
  itemCount: number;
  activeConditionCount: number;
  unreadAlertCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type WatchlistPatch = {
  name?: string;
  description?: string | null;
  status?: "ACTIVE" | "ARCHIVED";
};

export type WatchlistItemBase = {
  id: string;
  watchlistId: string;
  instrumentId: string;
  reason: string | null;
  plannedHorizon: string | null;
  goalId: string | null;
  source: WatchlistItemSource;
  activeConditionCount: number;
  version: number;
};

export type WatchlistItemPatch = {
  reason?: string | null;
  plannedHorizon?: string | null;
  goalId?: string | null;
};

export type Availability = "available" | "stale" | "insufficient_data";

export type MarketAggregate = {
  price: number | null;
  previousClose: number | null;
  dailyMovePct: number | null;
  dataAsOf: string | null;
  status: Availability;
};

export type PortfolioRelationAggregate = {
  isHeld: boolean;
  quantity: number | null;
  weight: number | null;
  cost: number | null;
  unrealizedGainPct: number | null;
  dataAsOf: string | null;
};

export type RiskAggregate = {
  status: "increasing" | "decreasing" | "stable" | "insufficient_data";
  recentVolatility: number | null;
  previousVolatility: number | null;
  recentDrawdown: number | null;
  previousDrawdown: number | null;
  dataAsOf: string | null;
};

export type ValuationAggregate = {
  status: "low" | "fair" | "high" | "insufficient_data";
  label: string;
  source: string | null;
  dataAsOf: string | null;
};

export type EventAggregate = {
  id: string;
  title: string;
  source: string;
  canonicalUrl: string | null;
  publishedAt: string | null;
  matchBasis: "symbol_exact" | "name_exact" | "research_link";
};

export type IndustryConcentrationAggregate = {
  label: "组合行业集中度";
  sector: string | null;
  weight: number | null;
  level: "low" | "medium" | "high" | "critical" | "insufficient_data";
  dataAsOf: string | null;
};

export type AgentConclusionAggregate = {
  recommendationId: string;
  action: string;
  summary: string | null;
  status: string;
  createdAt: string;
};

export type WatchlistItemAggregate = {
  id: string;
  watchlistId: string;
  instrument: {
    id: string;
    symbol: string;
    name: string;
    assetType: string;
    sector: string | null;
  };
  reason: string | null;
  plannedHorizon: string | null;
  goal: { id: string; name: string } | null;
  source: WatchlistItemSource;
  version: number;
  market: MarketAggregate;
  portfolioRelation: PortfolioRelationAggregate;
  risk: RiskAggregate;
  valuation: ValuationAggregate;
  recentEvent: EventAggregate | null;
  industryConcentration: IndustryConcentrationAggregate;
  latestAgentConclusion: AgentConclusionAggregate | null;
  activeConditionCount: number;
  triggeredConditionCount: number;
  unreadAlertCount: number;
  lastCheckedAt: string | null;
};

export type WatchlistItemsSummary = {
  itemCount: number;
  heldCount: number;
  activeConditionCount: number;
  unreadAlertCount: number;
  insufficientDataCount: number;
  lastCheckedAt: string | null;
};

export type WatchlistItemsAggregate = {
  items: WatchlistItemAggregate[];
  summary: WatchlistItemsSummary;
};

export type WatchlistCheckResult = {
  status: "SUCCEEDED" | "PARTIAL" | "FAILED";
  checkedItemCount: number;
  itemIds: string[];
  evaluatedConditionCount: number;
  createdNotificationCount: number;
  marketRefreshAttempted: boolean;
  marketRefreshSucceeded: boolean;
  dataAsOf: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export class WatchlistDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "WatchlistDomainError";
  }
}
