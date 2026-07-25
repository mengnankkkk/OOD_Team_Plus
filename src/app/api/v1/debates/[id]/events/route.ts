import { NextRequest } from "next/server";

import { getSseEvents } from "@/server/extensions/sse/event-persister";
import { getDatabase, getRequestContext } from "@/server/http/context";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId } = getRequestContext(req);
  const db = getDatabase();
  const session = db.prepare("SELECT root_agent_run_id FROM debate_sessions WHERE id=? AND user_id=?")
    .get(id, userId) as { root_agent_run_id?: string } | undefined;
  db.close();
  if (!session?.root_agent_run_id) return Response.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Debate not found" } }, { status: 404 });
  return streamDebateEvents(req, session.root_agent_run_id);
}

function streamDebateEvents(req: NextRequest, analysisId: string): Response {
  const encoder = new TextEncoder();
  const initialLastEventId = req.headers.get("Last-Event-ID") ?? req.nextUrl.searchParams.get("after");
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastEventId = initialLastEventId;
      let lastHeartbeatAt = Date.now();
      let closed = false;
      const close = () => { if (!closed) { closed = true; controller.close(); } };
      const abort = () => close();
      req.signal.addEventListener("abort", abort, { once: true });
      try {
        controller.enqueue(encoder.encode(": connected\n\n"));
        while (!closed) {
          const events = getSseEvents(analysisId, lastEventId);
          for (const event of events) {
            controller.enqueue(encoder.encode(formatEvent(event)));
            lastEventId = event.id;
          }
          if (isTerminalRun(analysisId)) {
            await delay(250);
            for (const event of getSseEvents(analysisId, lastEventId)) controller.enqueue(encoder.encode(formatEvent(event)));
            close();
            break;
          }
          if (Date.now() - lastHeartbeatAt >= 15_000) {
            controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
            lastHeartbeatAt = Date.now();
          }
          await delay(500);
        }
      } catch (error) {
        if (!closed) controller.error(error);
      } finally {
        req.signal.removeEventListener("abort", abort);
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
}

function isTerminalRun(analysisId: string): boolean {
  const db = getDatabase();
  const run = db.prepare("SELECT status FROM agent_runs WHERE id=?").get(analysisId) as { status?: string } | undefined;
  db.close();
  return !run || ["completed", "failed", "cancelled", "blocked", "waiting_for_user", "interrupted"].includes(String(run.status).toLowerCase());
}

function formatEvent(event: ReturnType<typeof getSseEvents>[number]): string {
  const data = JSON.stringify({ ...event.payload, analysisId: event.analysisId, createdAt: event.createdAt });
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${data}\n\n`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
