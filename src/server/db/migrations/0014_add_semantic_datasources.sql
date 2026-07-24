CREATE TABLE IF NOT EXISTS metadata_datasources (
  id TEXT PRIMARY KEY,
  datasource_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  connection_type TEXT NOT NULL DEFAULT 'sqlite',
  schema_name TEXT,
  is_visible INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  sync_status TEXT NOT NULL DEFAULT 'active',
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_metadata_datasources_status
  ON metadata_datasources(status, is_visible, updated_at);

INSERT OR IGNORE INTO metadata_datasources
  (id, datasource_key, name, description, connection_type, schema_name,
   is_visible, status, sync_status, created_at, updated_at)
VALUES
  (
    'ds-local-sqlite',
    'local-sqlite',
    'Money Whisperer SQLite',
    '当前应用唯一 SQLite 数据库的实时结构',
    'sqlite',
    'main',
    1,
    'active',
    'active',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  );
