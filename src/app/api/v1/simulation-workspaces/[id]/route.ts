import { NextRequest, NextResponse } from "next/server";

import { getWorkspace } from "@/server/extensions/simulation/service";
import { getDatabase, getRequestContext, meta } from "@/server/http/context";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const workspace = getWorkspace(getRequestContext(req).userId, id);
  if (!workspace) return notFound();
  return NextResponse.json({ data: workspace, meta: meta() });
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const expectedVersion = Number.parseInt(req.headers.get("If-Match")?.replaceAll('"', "") ?? "", 10);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "A numeric If-Match header is required" } }, { status: 400 });
  const body = await req.json().catch(() => null) as { name?: string; status?: "ARCHIVED" } | null;
  if (!body || (!body.name?.trim() && body.status !== "ARCHIVED")) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "name or status=ARCHIVED is required" } }, { status: 422 });
  const { userId } = getRequestContext(req);
  const db = getDatabase();
  const row = db.prepare("SELECT id,row_version FROM simulation_workspaces WHERE id = ? AND user_id = ?").get(id, userId) as { id: string; row_version: number } | undefined;
  if (!row) { db.close(); return notFound(); }
  const result = db.prepare("UPDATE simulation_workspaces SET label = COALESCE(?, label), status = COALESCE(?, status), row_version = row_version + 1, updated_at = ? WHERE id = ? AND user_id = ? AND row_version = ?").run(body.name?.trim() || null, body.status === "ARCHIVED" ? "archived" : null, new Date().toISOString(), id, userId, expectedVersion);
  db.close();
  if (!result.changes) return NextResponse.json({ error: { code: "VERSION_CONFLICT", message: "Workspace version changed", details: { currentVersion: row.row_version } } }, { status: 412 });
  return NextResponse.json({ data: getWorkspace(userId, id), meta: meta() });
}

function notFound() { return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Workspace not found" } }, { status: 404 }); }
