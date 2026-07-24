import { NextRequest, NextResponse } from "next/server";

import { authError, requireAdmin } from "@/server/auth/http";
import { AuthFailure } from "@/server/auth/contracts";
import { getDatabase, getRequestContext, meta } from "@/server/http/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const context = getRequestContext(request);
    requireAdmin(context.user);
    const db = getDatabase();
    const transaction = db.transaction(() => {
      db.prepare(`DELETE FROM evidence_source_links
        WHERE evidence_id IN (
          SELECT id FROM evidence_items
          WHERE user_id = ? OR agent_run_id IN (SELECT id FROM agent_runs WHERE user_id = ?)
        )`).run(context.userId, context.userId);
      db.prepare("DELETE FROM evidence_items WHERE user_id = ? OR agent_run_id IN (SELECT id FROM agent_runs WHERE user_id = ?)").run(context.userId, context.userId);
      db.prepare("DELETE FROM pandadata_probes WHERE agent_run_id IN (SELECT id FROM agent_runs WHERE user_id = ?)").run(context.userId);
      db.prepare("DELETE FROM skill_runs WHERE agent_run_id IN (SELECT id FROM agent_runs WHERE user_id = ?)").run(context.userId);
      db.prepare("DELETE FROM tool_calls WHERE agent_run_id IN (SELECT id FROM agent_runs WHERE user_id = ?)").run(context.userId);
      db.prepare("DELETE FROM data_query_result_chunks WHERE query_id IN (SELECT id FROM data_queries WHERE user_id = ?)").run(context.userId);
      db.prepare("DELETE FROM generated_artifact_versions WHERE artifact_id IN (SELECT id FROM generated_artifacts WHERE user_id = ?)").run(context.userId);
      db.prepare("DELETE FROM message_artifacts WHERE message_id IN (SELECT m.id FROM messages m JOIN conversation_sessions c ON c.id = m.session_id WHERE c.user_id = ?)").run(context.userId);
      db.prepare("DELETE FROM generated_artifacts WHERE user_id = ?").run(context.userId);
      db.prepare("DELETE FROM data_queries WHERE user_id = ?").run(context.userId);
      db.prepare("DELETE FROM research_search_sources WHERE search_id IN (SELECT id FROM research_searches WHERE user_id = ?)").run(context.userId);
      db.prepare("DELETE FROM research_results WHERE search_id IN (SELECT id FROM research_searches WHERE user_id = ?)").run(context.userId);
      db.prepare("DELETE FROM research_searches WHERE user_id = ?").run(context.userId);
      db.prepare("DELETE FROM simulation_branch_events WHERE workspace_id IN (SELECT id FROM simulation_workspaces WHERE user_id = ?)").run(context.userId);
      db.prepare("DELETE FROM simulation_asset_snapshot_items WHERE snapshot_id IN (SELECT id FROM simulation_asset_snapshots WHERE workspace_id IN (SELECT id FROM simulation_workspaces WHERE user_id = ?))").run(context.userId);
      db.prepare("DELETE FROM simulation_asset_snapshots WHERE workspace_id IN (SELECT id FROM simulation_workspaces WHERE user_id = ?)").run(context.userId);
      db.prepare("DELETE FROM simulation_options WHERE workspace_id IN (SELECT id FROM simulation_workspaces WHERE user_id = ?)").run(context.userId);
      db.prepare("DELETE FROM simulation_option_batches WHERE workspace_id IN (SELECT id FROM simulation_workspaces WHERE user_id = ?)").run(context.userId);
      db.prepare("DELETE FROM simulation_branches WHERE workspace_id IN (SELECT id FROM simulation_workspaces WHERE user_id = ?)").run(context.userId);
      db.prepare("DELETE FROM simulation_workspaces WHERE user_id = ?").run(context.userId);
      db.prepare("DELETE FROM observation_condition_events WHERE user_id = ?").run(context.userId);
      db.prepare("DELETE FROM observation_conditions WHERE user_id = ?").run(context.userId);
      db.prepare("DELETE FROM notifications WHERE user_id = ?").run(context.userId);
      db.prepare("DELETE FROM notification_preferences WHERE user_id = ?").run(context.userId);
      db.prepare("DELETE FROM watchlist_items WHERE watchlist_id IN (SELECT id FROM watchlists WHERE user_id = ?)").run(context.userId);
      db.prepare("DELETE FROM watchlists WHERE user_id = ?").run(context.userId);
      db.prepare("DELETE FROM portfolio_score_snapshots WHERE portfolio_snapshot_id IN (SELECT id FROM portfolio_snapshots WHERE user_id = ?)").run(context.userId);
      db.prepare("DELETE FROM holding_snapshots WHERE portfolio_snapshot_id IN (SELECT id FROM portfolio_snapshots WHERE user_id = ?)").run(context.userId);
      db.prepare("DELETE FROM portfolio_snapshots WHERE user_id = ?").run(context.userId);
      db.prepare("DELETE FROM holdings WHERE user_id = ?").run(context.userId);
      db.prepare("DELETE FROM holding_parses WHERE user_id = ?").run(context.userId);
      db.prepare("DELETE FROM risk_assessments WHERE user_id = ?").run(context.userId);
      db.prepare("DELETE FROM goals WHERE user_id = ?").run(context.userId);
      db.prepare("DELETE FROM user_profiles WHERE user_id = ?").run(context.userId);
      db.prepare("DELETE FROM messages WHERE session_id IN (SELECT id FROM conversation_sessions WHERE user_id = ?)").run(context.userId);
      db.prepare("DELETE FROM conversation_output_preferences WHERE user_id = ?").run(context.userId);
      db.prepare("DELETE FROM conversation_sessions WHERE user_id = ?").run(context.userId);
      db.prepare("DELETE FROM recommendations WHERE user_id = ?").run(context.userId);
      db.prepare("DELETE FROM decision_logs WHERE user_id = ?").run(context.userId);
      db.prepare("DELETE FROM agent_run_events WHERE agent_run_id IN (SELECT id FROM agent_runs WHERE user_id = ?) OR root_run_id IN (SELECT id FROM agent_runs WHERE user_id = ?)").run(context.userId, context.userId);
      db.prepare("DELETE FROM agent_conflicts WHERE root_run_id IN (SELECT id FROM agent_runs WHERE user_id = ?)").run(context.userId);
      db.prepare("DELETE FROM agent_runs WHERE user_id = ?").run(context.userId);
    });
    transaction();
    db.close();
    return NextResponse.json({ data: { reset: true, userId: context.userId }, meta: meta() });
  } catch (error) {
    if (error instanceof AuthFailure) return authError(error);
    return NextResponse.json({ error: { code: "DEMO_RESET_FAILED", message: "Demo reset failed" } }, { status: 500 });
  }
}
