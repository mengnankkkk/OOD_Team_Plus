import { A2APublicError, type A2ATaskView } from "./contracts";
import {
  cancelA2ATask,
  completeA2ATask,
  failA2ATask,
  getA2ATask,
} from "./task-service";
import { getDatabase, parseJson } from "@/server/http/context";

export function refreshA2ATaskFromDomain(clientId: string, taskId: string): A2ATaskView {
  const task = getA2ATask(clientId, taskId);
  if (!task) throw new A2APublicError("TASK_NOT_FOUND", 404, "Task not found");
  if (!["submitted", "working"].includes(task.status) || !task.domainResourceId) return task;
  if (task.domainResourceType === "research_search") return refreshResearchTask(task);
  if (task.domainResourceType === "simulation_option_batch") return refreshSimulationTask(task);
  return task;
}

function refreshResearchTask(task: A2ATaskView): A2ATaskView {
  const db = getDatabase();
  const search = db.prepare(`SELECT s.id,s.query_text,s.status
    FROM research_searches s
    JOIN a2a_contexts c ON c.execution_user_id=s.user_id
    WHERE s.id=? AND c.id=? AND c.external_client_id=? AND c.deleted_at IS NULL`).get(
    task.domainResourceId,
    task.contextId,
    task.externalClientId,
  ) as { id: string; query_text: string; status: string } | undefined;
  if (!search || search.status === "running") {
    db.close();
    return task;
  }
  const items = db.prepare(`SELECT title,url,snippet,citation,adapter,created_at
    FROM research_results WHERE search_id=? ORDER BY created_at DESC,id DESC`).all(
    search.id,
  ) as Array<{
    title: string;
    url: string | null;
    snippet: string;
    citation: string | null;
    adapter: string;
    created_at: string;
  }>;
  const sources = db.prepare(`SELECT adapter,status,result_count,error_json
    FROM research_search_sources WHERE search_id=? ORDER BY adapter`).all(
    search.id,
  ) as Array<{
    adapter: string;
    status: string;
    result_count: number;
    error_json: string | null;
  }>;
  db.close();
  if (search.status === "canceled") return cancelA2ATask(task.externalClientId, task.id);
  const sourceStatuses = sources.map((source) => ({
    adapter: source.adapter.toUpperCase(),
    status: source.status.toUpperCase(),
    resultCount: source.result_count,
    error: parseJson(source.error_json, null),
  }));
  if (search.status === "failed") {
    return failA2ATask(task.externalClientId, task.id, {
      code: "RESEARCH_FAILED",
      message: "All requested research sources failed",
      status: 502,
      retryable: true,
      details: { sourceStatuses },
    });
  }
  return completeA2ATask(task.externalClientId, task.id, {
    message: `Research search '${search.query_text}' returned ${items.length} result(s).`,
    artifacts: [{
      artifactId: search.id,
      name: "research_results",
      text: items.map((item) => `${item.title}: ${item.url ?? ""}`).join("\n"),
      data: {
        searchId: search.id,
        query: search.query_text,
        items: items.map((item) => ({
          title: item.title,
          url: item.url,
          snippet: item.snippet,
          citation: item.citation ?? item.url,
          adapter: item.adapter.toUpperCase(),
          createdAt: item.created_at,
        })),
        sourceStatuses,
      },
    }],
  });
}

function refreshSimulationTask(task: A2ATaskView): A2ATaskView {
  const db = getDatabase();
  const batch = db.prepare(`SELECT
      b.id,b.workspace_id,b.branch_id,b.agent_run_id,b.status,
      r.model_provider,r.failure_code,r.failure_message
    FROM simulation_option_batches b
    JOIN simulation_workspaces w ON w.id=b.workspace_id
    JOIN a2a_contexts c ON c.execution_user_id=w.user_id
    LEFT JOIN agent_runs r ON r.id=b.agent_run_id
    WHERE b.id=? AND c.id=? AND c.external_client_id=? AND c.deleted_at IS NULL`).get(
    task.domainResourceId,
    task.contextId,
    task.externalClientId,
  ) as {
    id: string;
    workspace_id: string;
    branch_id: string;
    agent_run_id: string;
    status: string;
    model_provider: string | null;
    failure_code: string | null;
    failure_message: string | null;
  } | undefined;
  if (!batch || ["queued", "running"].includes(batch.status)) {
    db.close();
    return task;
  }
  const items = db.prepare(`SELECT id,sequence_no,label,description_text,trades_json,analysis_json
    FROM simulation_options WHERE batch_id=? ORDER BY sequence_no`).all(batch.id) as Array<{
    id: string;
    sequence_no: number;
    label: string;
    description_text: string;
    trades_json: string;
    analysis_json: string;
  }>;
  db.close();
  if (batch.status === "cancelled") return cancelA2ATask(task.externalClientId, task.id);
  if (batch.status === "failed" || batch.status === "interrupted") {
    return failA2ATask(task.externalClientId, task.id, {
      code: batch.failure_code ?? "SIMULATION_FAILED",
      message: batch.failure_message ?? "Simulation option generation failed",
      status: 502,
      retryable: true,
    });
  }
  const data = {
    batch: {
      batchId: batch.id,
      workspaceId: batch.workspace_id,
      branchId: batch.branch_id,
      analysisId: batch.agent_run_id,
      status: batch.status.toUpperCase(),
      provider: batch.model_provider,
    },
    items: items.map((item) => ({
      id: item.id,
      sequenceNo: item.sequence_no,
      label: item.label,
      summary: item.description_text,
      trades: parseJson(item.trades_json, []),
      analysis: parseJson(item.analysis_json, {}),
    })),
  };
  return completeA2ATask(task.externalClientId, task.id, {
    message: `Simulation generated ${items.length} option(s).`,
    artifacts: [{
      artifactId: batch.id,
      name: "simulation_options",
      text: items.map((item) => `${item.sequence_no + 1}. ${item.label}`).join("\n"),
      data,
    }],
  });
}
