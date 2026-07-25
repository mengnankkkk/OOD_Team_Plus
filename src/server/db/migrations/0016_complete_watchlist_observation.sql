ALTER TABLE watchlist_items
  ADD COLUMN goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL;

ALTER TABLE watchlist_items
  ADD COLUMN source_type TEXT NOT NULL DEFAULT 'user'
  CHECK(source_type IN ('user','agent','import'));

DROP INDEX IF EXISTS idx_watchlists_user_name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlists_user_name
  ON watchlists(user_id, name)
  WHERE status != 'deleted';

WITH ranked_active_items AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY watchlist_id, instrument_id
      ORDER BY created_at, id
    ) AS duplicate_rank
  FROM watchlist_items
  WHERE status = 'active'
)
UPDATE watchlist_items
SET
  status = 'removed',
  removed_at = COALESCE(removed_at, updated_at, created_at),
  updated_at = COALESCE(updated_at, created_at),
  row_version = row_version + 1
WHERE id IN (
  SELECT id
  FROM ranked_active_items
  WHERE duplicate_rank > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlist_items_active_instrument
  ON watchlist_items(watchlist_id, instrument_id)
  WHERE status = 'active';

ALTER TABLE observation_conditions
  ADD COLUMN watchlist_item_id TEXT REFERENCES watchlist_items(id) ON DELETE SET NULL;

ALTER TABLE observation_conditions
  ADD COLUMN severity TEXT NOT NULL DEFAULT 'attention'
  CHECK(severity IN ('information','attention','important','urgent'));

ALTER TABLE observation_conditions
  ADD COLUMN threshold_date TEXT;

ALTER TABLE observation_conditions
  ADD COLUMN window_days INTEGER;

ALTER TABLE observation_conditions
  ADD COLUMN config_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE observation_conditions
  ADD COLUMN last_triggered_at TEXT;

CREATE INDEX IF NOT EXISTS idx_observation_conditions_watchlist_item
  ON observation_conditions(watchlist_item_id, status, created_at);

CREATE TABLE IF NOT EXISTS rss_item_instruments (
  id TEXT PRIMARY KEY,
  rss_item_id TEXT NOT NULL REFERENCES rss_items(id) ON DELETE CASCADE,
  instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  match_basis TEXT NOT NULL
    CHECK(match_basis IN ('symbol_exact','name_exact','research_link')),
  matched_text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rss_item_instruments_unique
  ON rss_item_instruments(rss_item_id, instrument_id);

CREATE INDEX IF NOT EXISTS idx_rss_item_instruments_instrument
  ON rss_item_instruments(instrument_id, created_at);

INSERT OR IGNORE INTO observation_conditions (
  id,
  user_id,
  instrument_id,
  condition_type,
  threshold_decimal,
  status,
  version,
  created_at,
  updated_at,
  watchlist_item_id,
  severity,
  window_days,
  config_json
)
SELECT
  'condition_watchlist_' || item.id,
  watchlist.user_id,
  item.instrument_id,
  'DRAWDOWN_REACH',
  CAST(ABS(item.drawdown_threshold_bps) / 10000.0 AS TEXT),
  'active',
  1,
  item.created_at,
  item.updated_at,
  item.id,
  'attention',
  20,
  '{}'
FROM watchlist_items AS item
JOIN watchlists AS watchlist ON watchlist.id = item.watchlist_id
WHERE item.status = 'active'
  AND watchlist.status = 'active'
  AND item.drawdown_threshold_bps IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM observation_conditions AS existing
    WHERE (
        existing.watchlist_item_id = item.id
        OR (
          existing.watchlist_item_id IS NULL
          AND existing.user_id = watchlist.user_id
          AND existing.instrument_id = item.instrument_id
        )
      )
      AND existing.condition_type = 'DRAWDOWN_REACH'
      AND existing.status = 'active'
      AND CAST(existing.threshold_decimal AS REAL) = ABS(item.drawdown_threshold_bps) / 10000.0
      AND COALESCE(existing.window_days, 20) = 20
  );
