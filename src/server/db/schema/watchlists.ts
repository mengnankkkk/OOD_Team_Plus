import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export {
  notificationInsertSchema,
  notificationPreferencesInsertSchema,
  notificationPreferencesSelectSchema,
  notificationSelectSchema,
  portfolioScoreSnapshotInsertSchema,
  portfolioScoreSnapshotSelectSchema,
  rssFeedInsertSchema,
  rssFeedSelectSchema,
  rssItemInsertSchema,
  rssItemSelectSchema,
  watchlistInsertSchema,
  watchlistItemInsertSchema,
  watchlistItemSelectSchema,
  watchlistSelectSchema,
} from "./watchlists.zod";
import {
  WATCHLIST_ITEM_STATUSES,
  WATCHLIST_STATUSES,
} from "./watchlists.zod";
import { NOTIFICATION_MODES, NOTIFICATION_SEVERITIES, RSS_FEED_STATUSES } from "./enums";

export const watchlists = sqliteTable(
  "watchlists",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status", { enum: WATCHLIST_STATUSES }).notNull().default("active"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
    rowVersion: integer("row_version").notNull().default(1),
  },
  (t) => [index("idx_watchlists_user_created").on(t.userId, t.createdAt), uniqueIndex("idx_watchlists_user_name").on(t.userId, t.name)],
);

export const watchlistItems = sqliteTable(
  "watchlist_items",
  {
    id: text("id").primaryKey(),
    watchlistId: text("watchlist_id").notNull(),
    instrumentId: text("instrument_id").notNull(),
    reason: text("reason"),
    plannedHorizon: text("planned_horizon"),
    status: text("status", { enum: WATCHLIST_ITEM_STATUSES }).notNull().default("active"),
    addedAt: text("added_at").notNull(),
    removedAt: text("removed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    rowVersion: integer("row_version").notNull().default(1),
  },
  (t) => [index("idx_watchlist_items_watchlist_added").on(t.watchlistId, t.addedAt), index("idx_watchlist_items_instrument_status").on(t.instrumentId, t.status)],
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    severity: text("severity", { enum: NOTIFICATION_SEVERITIES }).notNull(),
    title: text("title").notNull(),
    bodyText: text("body_text").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id"),
    groupKey: text("group_key"),
    conditionId: text("condition_id"),
    eventId: text("event_id"),
    readAt: text("read_at"),
    dismissedAt: text("dismissed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    rowVersion: integer("row_version").notNull().default(1),
  },
  (t) => [index("idx_notifications_user_created").on(t.userId, t.createdAt), index("idx_notifications_user_group").on(t.userId, t.groupKey, t.createdAt)],
);

export const notificationPreferences = sqliteTable(
  "notification_preferences",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().unique(),
    mode: text("mode", { enum: NOTIFICATION_MODES }).notNull().default("important_only"),
    quietHoursStart: text("quiet_hours_start"),
    quietHoursEnd: text("quiet_hours_end"),
    channelsJson: text("channels_json"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    rowVersion: integer("row_version").notNull().default(1),
  },
  (t) => [index("idx_notification_preferences_user_updated").on(t.userId, t.updatedAt)],
);

export const rssFeeds = sqliteTable(
  "rss_feeds",
  {
    id: text("id").primaryKey(),
    url: text("url").notNull().unique(),
    siteUrl: text("site_url"),
    title: text("title").notNull(),
    description: text("description"),
    language: text("language").notNull().default("zh"),
    status: text("status", { enum: RSS_FEED_STATUSES }).notNull().default("active"),
    etag: text("etag"),
    lastModified: text("last_modified"),
    lastSyncedAt: text("last_synced_at"),
    lastErrorMessage: text("last_error_message"),
    syncIntervalMinutes: integer("sync_interval_minutes").notNull().default(60),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
    rowVersion: integer("row_version").notNull().default(1),
  },
  (t) => [index("idx_rss_feeds_status_synced").on(t.status, t.lastSyncedAt)],
);

export const rssItems = sqliteTable(
  "rss_items",
  {
    id: text("id").primaryKey(),
    feedId: text("feed_id").notNull(),
    guid: text("guid").notNull(),
    title: text("title").notNull(),
    link: text("link"),
    summary: text("summary"),
    author: text("author"),
    publishedAt: text("published_at"),
    categoriesJson: text("categories_json"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("idx_rss_items_feed_guid").on(t.feedId, t.guid), index("idx_rss_items_feed_created").on(t.feedId, t.createdAt)],
);

export const portfolioScoreSnapshots = sqliteTable(
  "portfolio_score_snapshots",
  {
    id: text("id").primaryKey(),
    portfolioSnapshotId: text("portfolio_snapshot_id").notNull().unique(),
    healthScore: integer("health_score").notNull(),
    riskScore: integer("risk_score").notNull(),
    scoreVersion: text("score_version").notNull(),
    componentsJson: text("components_json").notNull(),
    missingMetricsJson: text("missing_metrics_json"),
    computedAt: text("computed_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_portfolio_score_snapshots_created").on(t.scoreVersion, t.createdAt)],
);
