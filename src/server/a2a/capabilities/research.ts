/* eslint-disable max-lines */

import {
  startResearchSearch,
  type ResearchAdapter,
  type ResearchSearchRunResult,
} from "@/server/extensions/search/service";
import { getDatabase, isoNow, parseJson } from "@/server/http/context";

import {
  A2APublicError,
  type A2ATaskView,
  type CapabilityAdapterInput,
  type CapabilityCancellationInput,
} from "../contracts";
import {
  cancelA2ATask,
  completeA2ATask,
  failA2ATask,
  getA2ATask,
  setA2ATaskDomainResource,
  startA2ATask,
} from "../task-service";

const allowedAdapters = new Set<ResearchAdapter>(["WEB", "MCP", "KNOWLEDGE_BASE", "RSS"]);
type ActiveResearch = {
  clientId: string;
  taskId: string;
  controller: AbortController;
};
const activeResearchTasks = new Map<string, ActiveResearch>();
const activeResearchSearches = new Map<string, ActiveResearch>();

export async function runResearchCapability(input: CapabilityAdapterInput): Promise<A2ATaskView> {
  if (input.operation === "get_results") {
    startA2ATask(input.principal.clientId, input.task.id);
    return completeFromStored(input, requiredString(input.input.searchId, "searchId"));
  }
  if (input.operation === "cancel") {
    startA2ATask(input.principal.clientId, input.task.id);
    return cancelStoredSearch(input, requiredString(input.input.searchId, "searchId"));
  }
  const request = researchRequest(input);
  startA2ATask(input.principal.clientId, input.task.id);
  const controller = new AbortController();
  const started = startResearchSearch({
    userId: input.context.executionUserId,
    query: request.query,
    adapters: request.adapters,
    maximumResults: request.maximumResults,
    signal: controller.signal,
    parentSearchId: request.parentSearchId,
  });
  const active = {
    clientId: input.principal.clientId,
    taskId: input.task.id,
    controller,
  };
  activeResearchTasks.set(input.task.id, active);
  activeResearchSearches.set(started.searchId, active);
  const task = setA2ATaskDomainResource(
    input.principal.clientId,
    input.task.id,
    "research_search",
    started.searchId,
  );
  void started.completion
    .then((result) => publishResearchCompletion(input, request.query, result))
    .catch((error: unknown) => {
      const current = getA2ATask(input.principal.clientId, input.task.id);
      if (current?.status === "canceled") return;
      failA2ATask(input.principal.clientId, input.task.id, {
        code: "RESEARCH_FAILED",
        message: error instanceof Error ? error.message : "Research failed",
        status: 502,
        retryable: true,
      });
    })
    .finally(() => {
      if (activeResearchTasks.get(input.task.id) === active) {
        activeResearchTasks.delete(input.task.id);
      }
      if (activeResearchSearches.get(started.searchId) === active) {
        activeResearchSearches.delete(started.searchId);
      }
    });
  return task;
}

export function cancelResearchCapability(input: CapabilityCancellationInput): void {
  const active = activeResearchTasks.get(input.task.id)
    ?? (input.task.domainResourceId
      ? activeResearchSearches.get(input.task.domainResourceId)
      : undefined);
  active?.controller.abort();
  if (!input.task.domainResourceId) return;
  const db = getDatabase();
  db.prepare(`UPDATE research_searches SET status='canceled',completed_at=?
    WHERE id=? AND status='running'`).run(isoNow(), input.task.domainResourceId);
  db.close();
}

function researchRequest(input: CapabilityAdapterInput): {
  query: string;
  adapters: ResearchAdapter[];
  maximumResults: number;
  parentSearchId?: string;
} {
  if (!["start", "refine", "retry"].includes(input.operation)) {
    throw new A2APublicError("INVALID_OPERATION", 422, "Unsupported research operation");
  }
  if (input.operation === "retry") {
    const searchId = requiredString(input.input.searchId, "searchId");
    const owned = ownedSearch(input, searchId);
    const db = getDatabase();
    const failed = db.prepare(`SELECT adapter FROM research_search_sources
      WHERE search_id=? AND status='failed' ORDER BY adapter`).all(searchId) as Array<{ adapter: string }>;
    db.close();
    const retryAdapters = failed.map((row) => row.adapter.toUpperCase()).filter(isAdapter);
    if (!retryAdapters.length) {
      throw new A2APublicError(
        "NO_FAILED_SOURCES",
        409,
        "The research search has no failed sources to retry",
      );
    }
    return {
      query: optionalString(input.input.query) ?? String(owned.query_text),
      adapters: retryAdapters,
      maximumResults: maximumResults(input.input.maximumResults),
      parentSearchId: searchId,
    };
  }
  if (input.operation === "refine") {
    const parentSearchId = requiredString(input.input.parentSearchId, "parentSearchId");
    ownedSearch(input, parentSearchId);
    return {
      query: optionalString(input.input.query) ?? input.text,
      adapters: adapters(input.input.adapters),
      maximumResults: maximumResults(input.input.maximumResults),
      parentSearchId,
    };
  }
  return {
    query: optionalString(input.input.query) ?? input.text,
    adapters: adapters(input.input.adapters),
    maximumResults: maximumResults(input.input.maximumResults),
  };
}

function publishResearchCompletion(
  input: CapabilityAdapterInput,
  query: string,
  result: ResearchSearchRunResult,
): void {
  const current = getA2ATask(input.principal.clientId, input.task.id);
  if (!current || current.status === "canceled" || result.status === "CANCELED") return;
  if (result.status === "FAILED") {
    failA2ATask(input.principal.clientId, input.task.id, {
      code: "RESEARCH_FAILED",
      message: "All requested research sources failed",
      status: 502,
      retryable: true,
      details: { sourceStatuses: result.sourceStatuses },
    });
    return;
  }
  completeA2ATask(input.principal.clientId, input.task.id, {
    message: `Research completed with ${result.resultCount} result(s).`,
    artifacts: [{
      artifactId: result.searchId,
      name: "research_results",
      text: result.results.map((item) => `${item.title}: ${item.url}`).join("\n"),
      data: {
        searchId: result.searchId,
        analysisId: result.analysisId,
        query,
        items: result.results.map((item) => ({ ...item, citation: item.url })),
        sourceStatuses: result.sourceStatuses,
      },
    }],
  });
}

function completeFromStored(input: CapabilityAdapterInput, searchId: string): A2ATaskView {
  const search = ownedSearch(input, searchId);
  const db = getDatabase();
  const items = db.prepare(`SELECT title,url,snippet,citation,adapter,created_at
    FROM research_results WHERE search_id=? ORDER BY created_at DESC,id DESC`).all(
    searchId,
  ) as Array<Record<string, unknown>>;
  const sources = db.prepare(`SELECT adapter,status,result_count,error_json
    FROM research_search_sources WHERE search_id=? ORDER BY adapter`).all(
    searchId,
  ) as Array<Record<string, unknown>>;
  db.close();
  setA2ATaskDomainResource(input.principal.clientId, input.task.id, "research_search", searchId);
  return completeA2ATask(input.principal.clientId, input.task.id, {
    message: `Research search '${String(search.query_text)}' returned ${items.length} result(s).`,
    artifacts: [{
      artifactId: searchId,
      name: "research_results",
      text: items.map((item) => `${String(item.title)}: ${String(item.url ?? "")}`).join("\n"),
      data: {
        searchId,
        query: search.query_text,
        items,
        sourceStatuses: sources.map((source) => ({
          ...source,
          error: parseJson(String(source.error_json ?? ""), null),
        })),
      },
    }],
  });
}

function cancelStoredSearch(input: CapabilityAdapterInput, searchId: string): A2ATaskView {
  ownedSearch(input, searchId);
  const active = activeResearchSearches.get(searchId);
  active?.controller.abort();
  const original = active ? getA2ATask(active.clientId, active.taskId) : null;
  if (original && ["submitted", "working", "input-required"].includes(original.status)) {
    cancelA2ATask(active!.clientId, active!.taskId);
  }
  const db = getDatabase();
  db.prepare("UPDATE research_searches SET status='canceled',completed_at=? WHERE id=? AND status='running'")
    .run(isoNow(), searchId);
  db.close();
  setA2ATaskDomainResource(input.principal.clientId, input.task.id, "research_search", searchId);
  return completeA2ATask(input.principal.clientId, input.task.id, {
    message: "Research search canceled.",
    artifacts: [{ artifactId: searchId, name: "research_results", text: "Canceled", data: { searchId, status: "CANCELED" } }],
  });
}

function ownedSearch(input: CapabilityAdapterInput, searchId: string): Record<string, unknown> {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM research_searches WHERE id=? AND user_id=?").get(
    searchId,
    input.context.executionUserId,
  ) as Record<string, unknown> | undefined;
  db.close();
  if (!row) throw new A2APublicError("TASK_NOT_FOUND", 404, "Research search not found");
  return row;
}

function adapters(value: unknown): ResearchAdapter[] {
  if (!Array.isArray(value)) return ["WEB", "MCP", "KNOWLEDGE_BASE", "RSS"];
  const parsed = value.map(String).map((item) => item.toUpperCase()).filter(isAdapter);
  if (!parsed.length) throw new A2APublicError("INVALID_REQUEST", 422, "At least one research adapter is required");
  return [...new Set(parsed)];
}

function isAdapter(value: string): value is ResearchAdapter {
  return allowedAdapters.has(value as ResearchAdapter);
}

function maximumResults(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 10);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 50) : 10;
}

function requiredString(value: unknown, name: string): string {
  const result = optionalString(value);
  if (!result) throw new A2APublicError("INVALID_REQUEST", 422, `${name} is required`);
  return result;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
