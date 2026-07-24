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
  if (!req.headers.get("If-Match")) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "If-Match header required" } }, { status: 400 });
  const body = await req.json().catch(() => null) as { name?: string; status?: "ACTIVE" | "ARCHIVED" } | null;
  const { userId } = getRequestContext(req);
  const db = getDatabase();
  const row = db.prepare("SELECT id FROM simulation_workspaces WHERE id = ? AND user_id = ?").get(id, userId) as { id: string } | undefined;
  if (!row) { db.close(); return notFound(); }
  db.prepare("UPDATE simulation_workspaces SET label = COALESCE(?, label), status = COALESCE(?, status), row_version = row_version + 1, updated_at = ? WHERE id = ? AND user_id = ?").run(body?.name ?? null, body?.status === "ARCHIVED" ? "archived" : body?.status === "ACTIVE" ? "active" : null, new Date().toISOString(), id, userId);
  db.close();
  return NextResponse.json({ data: getWorkspace(userId, id), meta: meta() });
}

function notFound() { return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Workspace not found" } }, { status: 404 }); }
