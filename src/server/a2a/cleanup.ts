import {
  A2APublicError,
  type ExternalClientPrincipal,
} from "./contracts";
import { writeA2AAudit } from "./audit";
import { cancelResearchCapability } from "./capabilities/research";
import { cancelSimulationCapability } from "./capabilities/simulation";
import { getDatabase, isoNow } from "@/server/http/context";

type ContextOwner = {
  id: string;
  external_client_id: string;
  execution_user_id: string;
};

export function cleanupExpiredA2AContexts(now = isoNow()): {
  deletedContexts: number;
  deletedExecutionUsers: number;
  canceledTasks: number;
} {
  const db = getDatabase();
  const rows = db.prepare(`SELECT id,external_client_id,execution_user_id FROM a2a_contexts
    WHERE deleted_at IS NULL AND expires_at<=? ORDER BY expires_at,id`).all(now) as ContextOwner[];
  db.close();
  let deletedContexts = 0;
  let deletedExecutionUsers = 0;
  let canceledTasks = 0;
  for (const row of rows) {
    const result = deleteOwnedContext(row, null);
    deletedContexts += 1;
    deletedExecutionUsers += result.deletedExecutionUsers;
    canceledTasks += result.canceledTasks;
  }
  return { deletedContexts, deletedExecutionUsers, canceledTasks };
}

export function deleteA2AContext(externalClientId: string, contextId: string): void {
  const db = getDatabase();
  const row = db.prepare(`SELECT id,external_client_id,execution_user_id FROM a2a_contexts
    WHERE id=? AND external_client_id=? AND deleted_at IS NULL`).get(
    contextId,
    externalClientId,
  ) as ContextOwner | undefined;
  db.close();
  if (!row) throw new A2APublicError("CONTEXT_NOT_FOUND", 404, "Context not found");
  deleteOwnedContext(row, externalClientId);
}

function deleteOwnedContext(
  owner: ContextOwner,
  externalClientId: string | null,
): { deletedExecutionUsers: number; canceledTasks: number } {
  const db = getDatabase();
  try {
    db.pragma("foreign_keys = ON");
    cancelActiveCapabilityWork(db, owner);
    let canceledTasks = 0;
    let deletedExecutionUsers = 0;
    const transaction = db.transaction(() => {
      const context = externalClientId
        ? db.prepare("SELECT id FROM a2a_contexts WHERE id=? AND external_client_id=?").get(owner.id, externalClientId)
        : db.prepare("SELECT id FROM a2a_contexts WHERE id=?").get(owner.id);
      if (!context) throw new A2APublicError("CONTEXT_NOT_FOUND", 404, "Context not found");
      const canceled = db.prepare(`UPDATE a2a_tasks SET status='canceled',cancelled_at=?,completed_at=?
        WHERE context_id=? AND status IN ('submitted','working','input-required')`).run(
        isoNow(),
        isoNow(),
        owner.id,
      );
      canceledTasks = canceled.changes;
      deleteDomainData(db, owner.execution_user_id);
      db.prepare("DELETE FROM a2a_contexts WHERE id=?").run(owner.id);
      const deleted = db.prepare(`DELETE FROM users
        WHERE id=? AND username IS NULL AND password_hash IS NULL`).run(owner.execution_user_id);
      deletedExecutionUsers = deleted.changes;
    });
    transaction();
    writeA2AAudit({
      clientId: owner.external_client_id,
      action: externalClientId ? "A2A_CONTEXT_DELETE" : "A2A_CONTEXT_EXPIRE",
      targetType: "A2A_CONTEXT",
      targetId: owner.id,
      outcome: "SUCCEEDED",
      metadata: { canceledTasks },
    });
    return { deletedExecutionUsers, canceledTasks };
  } finally {
    db.close();
  }
}

function cancelActiveCapabilityWork(
  db: ReturnType<typeof getDatabase>,
  owner: ContextOwner,
): void {
  const tasks = db.prepare(`SELECT id,external_client_id,context_id,capability_id,operation,
      domain_resource_type,domain_resource_id
    FROM a2a_tasks
    WHERE context_id=? AND external_client_id=? AND status IN ('submitted','working','input-required')`)
    .all(owner.id, owner.external_client_id) as Array<{
      id: string;
      external_client_id: string;
      context_id: string;
      capability_id: string;
      operation: string;
      domain_resource_type: string | null;
      domain_resource_id: string | null;
    }>;
  const principal: ExternalClientPrincipal = {
    clientId: owner.external_client_id,
    name: "A2A context cleanup",
    capabilities: ["tasks_cancel"],
    rateLimitPerMinute: 1,
  };
  for (const task of tasks) {
    const view = {
      ...task,
      externalClientId: task.external_client_id,
      contextId: task.context_id,
      capabilityId: task.capability_id,
      domainResourceType: task.domain_resource_type,
      domainResourceId: task.domain_resource_id,
      status: "working" as const,
    };
    try {
      if (task.capability_id === "research_search") {
        cancelResearchCapability({ principal, task: view as never });
      } else if (task.capability_id === "scenario_simulation") {
        cancelSimulationCapability({ principal, task: view as never });
      }
    } catch {
      // Context deletion still removes all owned rows after best-effort cancellation.
    }
  }
}

function deleteDomainData(db: ReturnType<typeof getDatabase>, userId: string): void {
  db.prepare(`DELETE FROM research_results WHERE search_id IN
    (SELECT id FROM research_searches WHERE user_id=?)`).run(userId);
  db.prepare(`DELETE FROM research_search_sources WHERE search_id IN
    (SELECT id FROM research_searches WHERE user_id=?)`).run(userId);

  db.prepare(`DELETE FROM simulation_asset_snapshot_items WHERE snapshot_id IN
    (SELECT s.id FROM simulation_asset_snapshots s JOIN simulation_workspaces w ON w.id=s.workspace_id WHERE w.user_id=?)`).run(userId);
  for (const table of [
    "simulation_asset_snapshots",
    "simulation_options",
    "simulation_option_batches",
    "simulation_branch_events",
    "simulation_branches",
  ]) {
    db.prepare(`DELETE FROM ${table} WHERE workspace_id IN
      (SELECT id FROM simulation_workspaces WHERE user_id=?)`).run(userId);
  }
  db.prepare("DELETE FROM simulation_workspaces WHERE user_id=?").run(userId);

  db.prepare(`DELETE FROM debate_arguments WHERE debate_turn_id IN
    (SELECT id FROM debate_turns WHERE debate_session_id IN
      (SELECT id FROM debate_sessions WHERE user_id=?))`).run(userId);
  db.prepare(`DELETE FROM debate_judgements WHERE debate_session_id IN
    (SELECT id FROM debate_sessions WHERE user_id=?)`).run(userId);
  db.prepare(`DELETE FROM debate_turns WHERE debate_session_id IN
    (SELECT id FROM debate_sessions WHERE user_id=?)`).run(userId);
  db.prepare(`DELETE FROM debate_rounds WHERE debate_session_id IN
    (SELECT id FROM debate_sessions WHERE user_id=?)`).run(userId);
  db.prepare("DELETE FROM debate_sessions WHERE user_id=?").run(userId);

  db.prepare(`DELETE FROM data_query_result_chunks WHERE query_id IN
    (SELECT id FROM data_queries WHERE user_id=?)`).run(userId);
  db.prepare(`DELETE FROM holding_snapshots WHERE portfolio_snapshot_id IN
    (SELECT id FROM portfolio_snapshots WHERE user_id=?)`).run(userId);
  db.prepare(`DELETE FROM messages WHERE session_id IN
    (SELECT id FROM conversation_sessions WHERE user_id=?)`).run(userId);
  db.prepare(`DELETE FROM agent_run_events WHERE agent_run_id IN
    (SELECT id FROM agent_runs WHERE user_id=?) OR root_run_id IN
    (SELECT id FROM agent_runs WHERE user_id=?)`).run(userId, userId);

  for (const table of [
    "information_requests",
    "recommendation_evidence",
    "recommendations",
    "evidence_items",
    "generated_artifacts",
    "data_queries",
    "research_searches",
    "holdings",
    "portfolio_snapshots",
    "risk_assessments",
    "goals",
    "user_profiles",
    "agent_runs",
    "conversation_sessions",
  ]) {
    deleteByUserIfPresent(db, table, userId);
  }
}

function deleteByUserIfPresent(
  db: ReturnType<typeof getDatabase>,
  table: string,
  userId: string,
): void {
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
  if (!exists) return;
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>;
  if (columns.some((column) => column.name === "user_id")) {
    db.prepare(`DELETE FROM ${table} WHERE user_id=?`).run(userId);
  }
}
