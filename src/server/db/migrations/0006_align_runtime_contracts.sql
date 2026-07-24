ALTER TABLE holdings ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE observation_conditions ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE holding_parses ADD COLUMN confirmed_holding_ids_json TEXT;
ALTER TABLE holding_parses ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1;
