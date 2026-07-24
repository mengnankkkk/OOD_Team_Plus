# Drizzle Migrations

This directory is the Drizzle output target for SQLite schema migrations.

Incremental columns tracked by the extension schema layer:

- `message_artifacts.generated_artifact_id` -> nullable `TEXT`, FK `generated_artifacts.id`, `ON DELETE RESTRICT`
- `watch_conditions.holding_id` -> nullable `TEXT`, FK `holdings.id`, `ON DELETE CASCADE`
- `watch_conditions.last_metric_snapshot_json` -> nullable `TEXT`
- `watch_conditions.last_crossing_state` -> nullable `TEXT`, `CHECK IN ('below', 'inside', 'above', 'unknown')`
- `watch_condition_events.portfolio_snapshot_id` -> nullable `TEXT`, FK `portfolio_snapshots.id`, `ON DELETE SET NULL`
- `watch_condition_events.holding_snapshot_id` -> nullable `TEXT`, FK `holding_snapshots.id`, `ON DELETE SET NULL`
- `watch_condition_events.threshold_decimal` -> nullable `TEXT`
- `watch_condition_events.previous_value_decimal` -> nullable `TEXT`
- `watch_condition_events.metric_snapshot_json` -> nullable `TEXT`
- `watch_condition_events.dedupe_key` -> nullable `TEXT`
- `information_requests` -> persisted Agent clarification questions and answers
