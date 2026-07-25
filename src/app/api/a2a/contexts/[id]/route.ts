import { NextRequest } from "next/server";

import { authenticateExternalRequest, requireA2ACapability } from "@/server/a2a/auth";
import { deleteA2AContext } from "@/server/a2a/cleanup";
import { asPublicError } from "@/server/a2a/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const principal = authenticateExternalRequest(request);
    requireA2ACapability(principal, "tasks_cancel");
    deleteA2AContext(principal.clientId, (await params).id);
    return new Response(null, { status: 204 });
  } catch (error) {
    const publicError = asPublicError(error);
    return Response.json({ error: publicError }, {
      status: publicError.status,
      headers: { "content-type": "application/a2a+json; charset=utf-8" },
    });
  }
}
