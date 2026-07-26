ALTER TABLE data_queries
  ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_data_queries_user_idempotency
  ON data_queries(user_id, idempotency_key);
