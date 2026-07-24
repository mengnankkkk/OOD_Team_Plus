import { NextRequest, NextResponse } from "next/server";

import { deleteArtifact, getArtifact, updateArtifact } from "@/server/extensions/artifacts/service";
import { getRequestContext, meta } from "@/server/http/context";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const artifact = getArtifact(getRequestContext(req).userId, id);
  if (!artifact) return notFound();
  return NextResponse.json({ data: artifact, meta: meta() });
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const header = req.headers.get("If-Match");
  if (!header) return invalid("If-Match required");
  const expectedVersion = Number.parseInt(header.replaceAll('"', ""), 10);
  if (!Number.isFinite(expectedVersion)) return invalid("Invalid If-Match");
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return invalid("Invalid JSON");
  try {
    const artifact = updateArtifact(getRequestContext(req).userId, id, expectedVersion, body as { title?: string; content?: string; editSummary?: string });
    if (!artifact) return notFound();
    return NextResponse.json({ data: artifact, meta: meta() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Artifact update failed";
    return NextResponse.json({ error: { code: message === "VERSION_CONFLICT" ? "VERSION_CONFLICT" : "ARTIFACT_CONTENT_UNSAFE", message } }, { status: message === "VERSION_CONFLICT" ? 412 : 422 });
  }
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  if (!req.headers.get("If-Match")) return invalid("If-Match required");
  deleteArtifact(getRequestContext(req).userId, id);
  return new Response(null, { status: 204 });
}

function notFound() { return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Artifact not found" } }, { status: 404 }); }
function invalid(message: string) { return NextResponse.json({ error: { code: "INVALID_REQUEST", message } }, { status: 400 }); }
