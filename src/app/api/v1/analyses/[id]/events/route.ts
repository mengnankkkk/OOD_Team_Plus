import { NextRequest } from "next/server";
import { getDatabase, getRequestContext } from "@/server/http/context";
import { getSseEvents } from "@/server/extensions/sse/event-persister";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const lastEventId = req.headers.get("Last-Event-ID");
  const { id } = await params;
  const db = getDatabase();
  const run = db.prepare("SELECT id FROM agent_runs WHERE id = ? AND user_id = ?").get(id, getRequestContext(req).userId);
  db.close();
  if (!run) return Response.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Analysis not found" } }, { status: 404 });
  const events = getSseEvents(id, lastEventId);
  const payload = events.length
    ? events.map((event) => `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify({ ...event.payload, analysisId: event.analysisId, createdAt: event.createdAt })}\n\n`).join("")
    : ": connected\n\n";

  return new Response(payload, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
