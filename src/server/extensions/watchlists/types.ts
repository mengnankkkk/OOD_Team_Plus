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
