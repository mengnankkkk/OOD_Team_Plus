import { z } from "zod";

import { NOTIFICATION_MODES, NOTIFICATION_SEVERITIES, RSS_FEED_STATUSES } from "./enums";

export const WATCHLIST_STATUSES = ["active", "archived", "deleted"] as const;
export const WATCHLIST_ITEM_STATUSES = ["active", "removed"] as const;

const nonEmptyText = z.string().trim().min(1);
const optionalText = nonEmptyText.nullable().optional();
const hhmmSchema = z.string().trim().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

const watchlistBaseSchema = z.object({
  id: nonEmptyText,
  userId: nonEmptyText,
  name: z.string().trim().min(1).max(100),
  description: optionalText,
  status: z.enum(WATCHLIST_STATUSES).default("active"),
  createdAt: nonEmptyText,
  updatedAt: nonEmptyText,
  deletedAt: optionalText,
  rowVersion: z.number().int().min(1).default(1),
});

const watchlistItemBaseSchema = z.object({
  id: nonEmptyText,
  watchlistId: nonEmptyText,
  instrumentId: z.string().trim().min(1),
  reason: optionalText,
  plannedHorizon: optionalText,
  status: z.enum(WATCHLIST_ITEM_STATUSES).default("active"),
  addedAt: nonEmptyText,
  removedAt: optionalText,
  createdAt: nonEmptyText,
  updatedAt: nonEmptyText,
  rowVersion: z.number().int().min(1).default(1),
});

const notificationBaseSchema = z.object({
  id: nonEmptyText,
  userId: nonEmptyText,
  severity: z.enum(NOTIFICATION_SEVERITIES),
  title: z.string().trim().min(1).max(200),
  bodyText: nonEmptyText,
  sourceType: nonEmptyText,
  sourceId: optionalText,
  groupKey: optionalText,
  conditionId: optionalText,
  eventId: optionalText,
  readAt: optionalText,
  dismissedAt: optionalText,
  createdAt: nonEmptyText,
  updatedAt: nonEmptyText,
  rowVersion: z.number().int().min(1).default(1),
});

const notificationPreferencesBaseSchema = z.object({
  id: nonEmptyText,
  userId: nonEmptyText,
  mode: z.enum(NOTIFICATION_MODES).default("important_only"),
  quietHoursStart: hhmmSchema.nullable().optional(),
  quietHoursEnd: hhmmSchema.nullable().optional(),
  channelsJson: optionalText,
  createdAt: nonEmptyText,
  updatedAt: nonEmptyText,
  rowVersion: z.number().int().min(1).default(1),
});

const rssFeedBaseSchema = z.object({
  id: nonEmptyText,
  url: z.string().trim().url(),
  siteUrl: z.string().trim().url().nullable().optional(),
  title: nonEmptyText,
  description: optionalText,
  language: z.string().trim().min(1).default("zh"),
  status: z.enum(RSS_FEED_STATUSES).default("active"),
  etag: optionalText,
  lastModified: optionalText,
  lastSyncedAt: optionalText,
  lastErrorMessage: optionalText,
  syncIntervalMinutes: z.number().int().min(1).default(60),
  createdBy: nonEmptyText,
  createdAt: nonEmptyText,
  updatedAt: nonEmptyText,
  deletedAt: optionalText,
  rowVersion: z.number().int().min(1).default(1),
});

const rssItemBaseSchema = z.object({
  id: nonEmptyText,
  feedId: nonEmptyText,
  guid: z.string().trim().min(1),
  title: z.string().trim().min(1),
  link: z.string().trim().url().nullable().optional(),
  summary: z.string().trim().min(1).max(5000).nullable().optional(),
  author: optionalText,
  publishedAt: optionalText,
  categoriesJson: optionalText,
  createdAt: nonEmptyText,
});

const portfolioScoreSnapshotBaseSchema = z.object({
  id: nonEmptyText,
  portfolioSnapshotId: nonEmptyText,
  healthScore: z.number().int().min(0).max(100),
  riskScore: z.number().int().min(0).max(100),
  scoreVersion: nonEmptyText,
  componentsJson: nonEmptyText,
  missingMetricsJson: nonEmptyText.nullable().optional(),
  computedAt: nonEmptyText,
  createdAt: nonEmptyText,
});

export const watchlistSelectSchema = watchlistBaseSchema;
export const watchlistInsertSchema = watchlistBaseSchema.superRefine((value, ctx) => {
  if (value.name.length < 1 || value.name.length > 100) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["name"], message: "name must be between 1 and 100 characters." });
  }
});

export const watchlistItemSelectSchema = watchlistItemBaseSchema;
export const watchlistItemInsertSchema = watchlistItemBaseSchema.superRefine(() => {
  // App-layer uniqueness: do not allow the same instrument twice in one active watchlist.
});

export const notificationSelectSchema = notificationBaseSchema;
export const notificationInsertSchema = notificationBaseSchema;

export const notificationPreferencesSelectSchema = notificationPreferencesBaseSchema;
export const notificationPreferencesInsertSchema = notificationPreferencesBaseSchema;

export const rssFeedSelectSchema = rssFeedBaseSchema;
export const rssFeedInsertSchema = rssFeedBaseSchema;

export const rssItemSelectSchema = rssItemBaseSchema;
export const rssItemInsertSchema = rssItemBaseSchema.superRefine((value, ctx) => {
  if (value.summary != null && value.summary.length > 5000) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["summary"], message: "summary must be at most 5000 characters." });
  }
});

export const portfolioScoreSnapshotSelectSchema = portfolioScoreSnapshotBaseSchema;
export const portfolioScoreSnapshotInsertSchema = portfolioScoreSnapshotBaseSchema.superRefine((value, ctx) => {
  if (value.healthScore < 0 || value.healthScore > 100) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["healthScore"], message: "healthScore must be between 0 and 100." });
  }

  if (value.riskScore < 0 || value.riskScore > 100) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["riskScore"], message: "riskScore must be between 0 and 100." });
  }
});

export type WatchlistInsert = z.infer<typeof watchlistInsertSchema>;
export type WatchlistSelect = z.infer<typeof watchlistSelectSchema>;
export type WatchlistItemInsert = z.infer<typeof watchlistItemInsertSchema>;
export type WatchlistItemSelect = z.infer<typeof watchlistItemSelectSchema>;
export type NotificationInsert = z.infer<typeof notificationInsertSchema>;
export type NotificationSelect = z.infer<typeof notificationSelectSchema>;
export type NotificationPreferencesInsert = z.infer<typeof notificationPreferencesInsertSchema>;
export type NotificationPreferencesSelect = z.infer<typeof notificationPreferencesSelectSchema>;
export type RssFeedInsert = z.infer<typeof rssFeedInsertSchema>;
export type RssFeedSelect = z.infer<typeof rssFeedSelectSchema>;
export type RssItemInsert = z.infer<typeof rssItemInsertSchema>;
export type RssItemSelect = z.infer<typeof rssItemSelectSchema>;
export type PortfolioScoreSnapshotInsert = z.infer<typeof portfolioScoreSnapshotInsertSchema>;
export type PortfolioScoreSnapshotSelect = z.infer<typeof portfolioScoreSnapshotSelectSchema>;
