import { getDatabase } from "@/server/http/context";
import type { SyncTableInput } from "@/types/app/semantic";

export type SemanticDatasource = {
  key: string;
  label: string;
  description: string;
  schemaName: string;
  tables: SyncTableInput[];
};

type TableRow = { name: string; type: string };
type ColumnRow = { name: string; type: string; notnull: number; dflt_value: string | null; pk: number; cid: number };

const INTERNAL_TABLES = new Set(["__drizzle_migrations", "migration_history", "idempotency_keys"]);

export function discoverSemanticDatasources(): { items: SemanticDatasource[] } {
  const db = getDatabase();
  try {
    const tableRows = db.prepare("SELECT name,type FROM pragma_table_list WHERE schema='main' ORDER BY name").all() as TableRow[];
    const tables = tableRows
      .filter((row) => row.type === "table" && !row.name.startsWith("sqlite_") && !INTERNAL_TABLES.has(row.name))
      .map((row): SyncTableInput => {
        const escapedName = row.name.replaceAll("'", "''");
        const columns = db.prepare(`SELECT cid,name,type,notnull,dflt_value,pk FROM pragma_table_info('${escapedName}') ORDER BY cid`).all() as ColumnRow[];
        return {
          physicalTableName: row.name,
          physicalDescription: null,
          semanticName: null,
          semanticDescription: null,
          isVisible: true,
          columns: columns.map((column) => ({
            physicalColumnName: column.name,
            ordinalPosition: column.cid + 1,
            dataType: column.type || "text",
            isNullable: column.notnull === 0,
            isPrimaryKey: column.pk > 0,
            defaultValue: column.dflt_value,
            physicalDescription: null,
            semanticName: null,
            semanticDescription: null,
            businessType: null,
            exampleValues: [],
            isVisible: true,
          })),
        };
      });
    return { items: [{ key: "local-sqlite", label: "Money Whisperer SQLite", description: "当前应用唯一 SQLite 数据库的实时结构", schemaName: "main", tables }] };
  } finally {
    db.close();
  }
}
