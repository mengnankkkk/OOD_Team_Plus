ALTER TABLE users ADD COLUMN preferred_locale TEXT
  CHECK(preferred_locale IS NULL OR preferred_locale IN ('zh-CN','en-US'));

ALTER TABLE conversation_sessions ADD COLUMN title_locale TEXT NOT NULL DEFAULT 'zh-CN';
ALTER TABLE messages ADD COLUMN content_locale TEXT NOT NULL DEFAULT 'zh-CN';
ALTER TABLE agent_runs ADD COLUMN requested_locale TEXT NOT NULL DEFAULT 'zh-CN';
ALTER TABLE recommendations ADD COLUMN content_locale TEXT NOT NULL DEFAULT 'zh-CN';
ALTER TABLE notifications ADD COLUMN content_locale TEXT NOT NULL DEFAULT 'zh-CN';
ALTER TABLE generated_artifacts ADD COLUMN content_locale TEXT NOT NULL DEFAULT 'zh-CN';
ALTER TABLE generated_artifact_versions ADD COLUMN content_locale TEXT NOT NULL DEFAULT 'zh-CN';
ALTER TABLE simulation_option_batches ADD COLUMN content_locale TEXT NOT NULL DEFAULT 'zh-CN';
ALTER TABLE information_requests ADD COLUMN content_locale TEXT NOT NULL DEFAULT 'zh-CN';
ALTER TABLE evidence_items ADD COLUMN source_locale TEXT NOT NULL DEFAULT 'zh-CN';
ALTER TABLE evidence_items ADD COLUMN summary_locale TEXT NOT NULL DEFAULT 'zh-CN';
ALTER TABLE evidence_items ADD COLUMN translation_metadata_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE rss_items ADD COLUMN source_locale TEXT NOT NULL DEFAULT 'zh-CN';

CREATE TABLE evidence_item_translations (
  id TEXT PRIMARY KEY,
  evidence_item_id TEXT NOT NULL REFERENCES evidence_items(id) ON DELETE CASCADE,
  target_locale TEXT NOT NULL CHECK(target_locale IN ('zh-CN','en-US')),
  title_text TEXT,
  summary_text TEXT NOT NULL,
  source_content_sha256 TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  translated_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(evidence_item_id, target_locale, source_content_sha256)
);

CREATE INDEX idx_evidence_item_translations_item
  ON evidence_item_translations(evidence_item_id, target_locale);
