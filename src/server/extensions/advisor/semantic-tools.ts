import type { SqliteDb } from "@/server/db/client.runtime";
import { persistSseEvent } from "@/server/extensions/sse/event-persister";
import { createId, isoNow, json } from "@/server/http/context";
import { pageColumns } from "@/server/semantic-layer/column-service";
import type { PageQuery } from "@/server/semantic-layer/contract";
import { createSemanticLayerDb } from "@/server/semantic-layer/database";
import { pageDomains } from "@/server/semantic-layer/domain-service";
import { getSemanticTableContext } from "@/server/semantic-layer/context-service";
import { pageTables } from "@/server/semantic-layer/table-service";

type SemanticDomain = Awaited<ReturnType<typeof pageDomains>>["items"][number];
type SemanticTableContext = NonNullable<Awaited<ReturnType<typeof getSemanticTableContext>>>;
type SemanticColumn = Awaited<ReturnType<typeof pageColumns>>["items"][number];
type LogicalForeignKey = SemanticTableContext["relations"][number];

export type AdvisorSemanticToolsContext = {
  available: boolean;
  domains: SemanticDomain[];
  tables: Array<{
    id: string;
    domainId: string;
    datasourceKey: string;
    schemaName?: string | null;
    physicalTableName: string;
    semanticName?: string | null;
    semanticDescription?: string | null;
    columnCount: number;
    logicalForeignKeys: LogicalForeignKey[];
  }>;
  columns: SemanticColumn[];
  toolCallIds: string[];
  error?: string;
};

type SemanticToolResult<T> = {
  toolCallId: string;
  result: T;
};

const semanticPage = (pageSize: number): PageQuery => ({
  pageNo: 1,
  pageSize,
  isVisible: true,
  sortBy: "updatedAt",
  sortOrder: "desc",
});

export async function loadAdvisorSemanticToolsContext(
  db: SqliteDb,
  input: { analysisId: string; question: string },
): Promise<AdvisorSemanticToolsContext> {
  const semanticDb = createSemanticLayerDb(db);
  const toolCallIds: string[] = [];

  try {
    const domains = await runSemanticTool(db, input.analysisId, "semantic.domain.view", {
      question: input.question,
      pageNo: 1,
      pageSize: 20,
    }, async () => pageDomains(semanticDb, semanticPage(20)), (result) => `${result.items.length}/${result.total} domains`);
    toolCallIds.push(domains.toolCallId);

    const tables = await runSemanticTool(db, input.analysisId, "semantic.table.query", {
      question: input.question,
      includeLogicalForeignKeys: true,
      pageNo: 1,
      pageSize: 20,
    }, async () => {
      const page = await pageTables(semanticDb, semanticPage(20));
      const contexts = (await Promise.all(page.items.map((table) => getSemanticTableContext(semanticDb, table.id))))
        .filter((context): context is SemanticTableContext => context !== null);
      return {
        total: page.total,
        items: contexts.map((context) => ({
          id: context.table.id,
          domainId: context.table.domainId,
          datasourceKey: context.table.datasourceKey,
          schemaName: context.table.schemaName,
          physicalTableName: context.table.physicalTableName,
          semanticName: context.table.semanticName,
          semanticDescription: context.table.semanticDescription,
          columnCount: context.columns.length,
          logicalForeignKeys: context.relations.slice(0, 12),
        })),
      };
    }, (result) => `${result.items.length}/${result.total} tables with logical foreign keys`);
    toolCallIds.push(tables.toolCallId);

    const tableIds = tables.result.items.map((table) => table.id).slice(0, 12);
    const columns = await runSemanticTool(db, input.analysisId, "semantic.column.view", {
      question: input.question,
      tableIds,
      pageSizePerTable: 30,
    }, async () => {
      const pages = await Promise.all(tableIds.map((tableId) => pageColumns(semanticDb, semanticPage(30), tableId)));
      return {
        total: pages.reduce((sum, page) => sum + page.total, 0),
        items: pages.flatMap((page) => page.items).slice(0, 120),
      };
    }, (result) => `${result.items.length}/${result.total} columns`);
    toolCallIds.push(columns.toolCallId);

    return {
      available: true,
      domains: domains.result.items,
      tables: tables.result.items,
      columns: columns.result.items,
      toolCallIds,
    };
  } catch (error) {
    return {
      available: false,
      domains: [],
      tables: [],
      columns: [],
      toolCallIds,
      error: safeMessage(error),
    };
  }
}

export function summarizeAdvisorSemanticToolsContext(context: AdvisorSemanticToolsContext) {
  return {
    available: context.available,
    configured: context.domains.length > 0 || context.tables.length > 0,
    error: context.error,
    domains: context.domains.map((domain) => ({
      id: domain.id,
      name: domain.name,
      description: domain.description,
    })),
    tables: context.tables.map((table) => ({
      id: table.id,
      domainId: table.domainId,
      datasourceKey: table.datasourceKey,
      schemaName: table.schemaName,
      physicalTableName: table.physicalTableName,
      semanticName: table.semanticName,
      semanticDescription: table.semanticDescription,
      columnCount: table.columnCount,
      logicalForeignKeys: table.logicalForeignKeys.map((relation) => ({
        sourceTableName: relation.sourceTableName,
        sourceColumnName: relation.sourceColumnName,
        targetTableName: relation.targetTableName,
        targetColumnName: relation.targetColumnName,
        relationType: relation.relationType,
        semanticDescription: relation.semanticDescription,
        confidence: relation.confidence,
      })),
    })),
    columns: context.columns.map((column) => ({
      tableId: column.tableId,
      physicalColumnName: column.physicalColumnName,
      semanticName: column.semanticName,
      semanticDescription: column.semanticDescription,
      businessType: column.businessType,
      dataType: column.dataType,
      isPrimaryKey: column.isPrimaryKey,
      exampleValues: column.exampleValues?.slice(0, 5),
    })),
    toolCallIds: context.toolCallIds,
  };
}

async function runSemanticTool<T>(
  db: SqliteDb,
  analysisId: string,
  toolName: string,
  args: Record<string, unknown>,
  operation: () => Promise<T>,
  summary: (result: T) => string,
): Promise<SemanticToolResult<T>> {
  const toolCallId = createId("tool");
  const startedAt = isoNow();
  const startedMs = Date.now();
  db.prepare(`INSERT INTO tool_calls
    (id,agent_run_id,data_source_id,tool_name,tool_version,status,arguments_json,started_at,created_at)
    VALUES (?,?,NULL,?,'semantic-layer-v1','running',?,?,?)`).run(
    toolCallId,
    analysisId,
    toolName,
    json(args),
    startedAt,
    startedAt,
  );
  persistSseEvent({ analysisId, type: "tool.started", payload: { toolName, toolCallId } });

  try {
    const result = await operation();
    const completedAt = isoNow();
    const resultSummary = summary(result);
    db.prepare("UPDATE tool_calls SET status='succeeded',result_summary=?,result_json=?,completed_at=?,latency_ms=? WHERE id=?")
      .run(resultSummary, json(result), completedAt, Date.now() - startedMs, toolCallId);
    persistSseEvent({ analysisId, type: "tool.completed", payload: { toolName, toolCallId, resultSummary } });
    return { toolCallId, result };
  } catch (error) {
    const completedAt = isoNow();
    db.prepare("UPDATE tool_calls SET status='failed',error_code='SEMANTIC_LAYER_UNAVAILABLE',error_message=?,completed_at=?,latency_ms=? WHERE id=?")
      .run(safeMessage(error), completedAt, Date.now() - startedMs, toolCallId);
    persistSseEvent({
      analysisId,
      type: "tool.failed",
      payload: { toolName, toolCallId, code: "SEMANTIC_LAYER_UNAVAILABLE", message: safeMessage(error) },
    });
    throw error;
  }
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
