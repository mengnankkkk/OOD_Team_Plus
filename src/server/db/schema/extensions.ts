export type IncrementalTableName =
  | "message_artifacts"
  | "watch_conditions"
  | "watch_condition_events";

export type IncrementalColumnDefinition = Readonly<{
  name: string;
  sqliteType: "TEXT";
  nullable: true;
  references?: string;
  onDelete?: "CASCADE" | "SET NULL" | "RESTRICT";
  checkValues?: readonly string[];
  description: string;
}>;

export const EXTENSION_INCREMENTAL_COLUMNS = {
  message_artifacts: [
    {
      name: "generated_artifact_id",
      sqliteType: "TEXT",
      nullable: true,
      references: "generated_artifacts.id",
      onDelete: "RESTRICT",
      description: "FK to generated_artifacts.id for generated artifact attachments.",
    },
  ],
  watch_conditions: [
    {
      name: "holding_id",
      sqliteType: "TEXT",
      nullable: true,
      references: "holdings.id",
      onDelete: "CASCADE",
      description: "Optional holding-scoped watch condition target.",
    },
    {
      name: "last_metric_snapshot_json",
      sqliteType: "TEXT",
      nullable: true,
      description: "JSON snapshot of the last successful metric evaluation.",
    },
    {
      name: "last_crossing_state",
      sqliteType: "TEXT",
      nullable: true,
      checkValues: ["below", "inside", "above", "unknown"],
      description: "Last known threshold crossing state.",
    },
  ],
  watch_condition_events: [
    {
      name: "portfolio_snapshot_id",
      sqliteType: "TEXT",
      nullable: true,
      references: "portfolio_snapshots.id",
      onDelete: "SET NULL",
      description: "Optional portfolio snapshot link for event provenance.",
    },
    {
      name: "holding_snapshot_id",
      sqliteType: "TEXT",
      nullable: true,
      references: "holding_snapshots.id",
      onDelete: "SET NULL",
      description: "Optional holding snapshot link for event provenance.",
    },
    {
      name: "threshold_decimal",
      sqliteType: "TEXT",
      nullable: true,
      description: "Threshold value at trigger time.",
    },
    {
      name: "previous_value_decimal",
      sqliteType: "TEXT",
      nullable: true,
      description: "Previous metric value before threshold crossing.",
    },
    {
      name: "metric_snapshot_json",
      sqliteType: "TEXT",
      nullable: true,
      description: "JSON snapshot of the evaluated metric evidence.",
    },
    {
      name: "dedupe_key",
      sqliteType: "TEXT",
      nullable: true,
      description: "Idempotency key for deduplicating crossing events.",
    },
  ],
} as const satisfies Record<IncrementalTableName, readonly IncrementalColumnDefinition[]>;

export function getIncrementalColumns(table: IncrementalTableName): readonly IncrementalColumnDefinition[] {
  return EXTENSION_INCREMENTAL_COLUMNS[table];
}

export function getIncrementalColumnNames(table: IncrementalTableName): string[] {
  return EXTENSION_INCREMENTAL_COLUMNS[table].map((column) => column.name);
}

export function getIncrementalMigrationNotes(): string[] {
  return [
    "message_artifacts: add nullable generated_artifact_id TEXT FK to generated_artifacts.id ON DELETE RESTRICT",
    "watch_conditions: add nullable holding_id TEXT FK to holdings.id ON DELETE CASCADE",
    "watch_conditions: add nullable last_metric_snapshot_json TEXT",
    "watch_conditions: add nullable last_crossing_state TEXT CHECK IN ('below','inside','above','unknown')",
    "watch_condition_events: add nullable portfolio_snapshot_id TEXT FK to portfolio_snapshots.id ON DELETE SET NULL",
    "watch_condition_events: add nullable holding_snapshot_id TEXT FK to holding_snapshots.id ON DELETE SET NULL",
    "watch_condition_events: add nullable threshold_decimal TEXT",
    "watch_condition_events: add nullable previous_value_decimal TEXT",
    "watch_condition_events: add nullable metric_snapshot_json TEXT",
    "watch_condition_events: add nullable dedupe_key TEXT",
  ] as const as string[];
}
