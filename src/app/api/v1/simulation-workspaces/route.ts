import { NextRequest, NextResponse } from "next/server";

import { createWorkspace } from "@/server/extensions/simulation/service";
import { getDatabase, getRequestContext, idempotencyKey, meta } from "@/server/http/context";
import { SimulationWorkspaceRequestSchema } from "@/server/extensions/schemas";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!idempotencyKey(req)) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Idempotency-Key required" } }, { status: 400 });
  const parsed = SimulationWorkspaceRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Invalid request", details: parsed.error.format() } }, { status: 400 });
  try {
    const result = createWorkspace(getRequestContext(req).userId, parsed.data);
    return NextResponse.json({ data: { id: result.workspaceId, status: "ACTIVE", portfolioSnapshotId: parsed.data.portfolioSnapshotId, rootBranchId: result.branchId, activeBranchId: result.branchId, version: result.version, analysis: { analysisId: result.analysisId, type: "BRANCH_OPTION_GENERATION", status: "COMPLETED", streamUrl: `/api/v1/analyses/${result.analysisId}/events` } }, meta: meta() }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: { code: "SNAPSHOT_NOT_USABLE", message: error instanceof Error ? error.message : "Snapshot not found" } }, { status: 422 });
  }
}

export async function GET(req: NextRequest) {
  const db = getDatabase();
  const { userId } = getRequestContext(req);
  const raw = Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 100) : 20;
  const rows = db.prepare("SELECT id, label, objective_text, status, portfolio_snapshot_id, active_branch_id, row_version, created_at, updated_at FROM simulation_workspaces WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?").all(userId, limit) as Array<Record<string, unknown>>;
  db.close();
  return NextResponse.json({ data: { items: rows.map((row) => ({ id: row.id, name: row.label, objectiveText: row.objective_text, status: String(row.status).toUpperCase(), portfolioSnapshotId: row.portfolio_snapshot_id, activeBranchId: row.active_branch_id, version: row.row_version, createdAt: row.created_at, updatedAt: row.updated_at })) }, meta: meta({ pagination: { limit, nextCursor: null, hasMore: false } }) });
}
