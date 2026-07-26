import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const evidenceItemTranslations = sqliteTable(
  "evidence_item_translations",
  {
    id: text("id").primaryKey(),
    evidenceItemId: text("evidence_item_id").notNull(),
    targetLocale: text("target_locale", { enum: ["zh-CN", "en-US"] }).notNull(),
    titleText: text("title_text"),
    summaryText: text("summary_text").notNull(),
    sourceContentSha256: text("source_content_sha256").notNull(),
    provider: text("provider"),
    model: text("model"),
    translatedAt: text("translated_at").notNull(),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_evidence_item_translations_source_locale").on(t.evidenceItemId, t.targetLocale, t.sourceContentSha256),
    index("idx_evidence_item_translations_item").on(t.evidenceItemId, t.targetLocale),
  ],
);
