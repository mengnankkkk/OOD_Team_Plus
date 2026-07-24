import { NextRequest, NextResponse } from "next/server";

import { previewArtifact } from "@/server/extensions/artifacts/service";
import { getRequestContext, meta } from "@/server/http/context";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const preview = previewArtifact(getRequestContext(req).userId, id);
  if (!preview) return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Artifact not found" } }, { status: 404 });
  return NextResponse.json({ data: preview, meta: meta() });
}
