import { NextRequest } from "next/server";

import {
  authenticateA2A,
  A2A_SERVICE_USER_ID,
  requireA2ACapability,
} from "@/server/a2a/auth";
import { A2APublicError } from "@/server/a2a/contracts";
import { getDatabase } from "@/server/http/context";
import { getSseEvents } from "@/server/extensions/sse/event-persister";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authentication = authenticateA2A(req);
  if (!authentication.ok) return a2aError(authentication.failure);
  try {
    requireA2ACapability(authentication.principal, "tasks_read");
  } catch (error) {
    if (error instanceof A2APublicError) {
      return a2aError({
        status: error.status,
        code: error.code,
        message: error.message,
      });
    }
    throw error;
  }
  if (authentication.principal.clientId !== "a2a-legacy-client") {
    return a2aError({
      status: 404,
      code: "RESOURCE_NOT_FOUND",
      message: "A2A analysis not found",
    });
  }
  const { id } = await params;
  const db = getDatabase();
  const run = db.prepare("SELECT id,status FROM agent_runs WHERE id=? AND user_id=?").get(id, A2A_SERVICE_USER_ID) as { id: string; status: string } | undefined;
  db.close();
  if (!run) {
    return a2aError({
      status: 404,
      code: "RESOURCE_NOT_FOUND",
      message: "A2A analysis not found",
    });
  }

  const encoder = new TextEncoder();
  const initialLastEventId = req.headers.get("Last-Event-ID");
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastEventId = initialLastEventId;
      let lastHeartbeatAt = Date.now();
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };
      const abort = () => close();
      req.signal.addEventListener("abort", abort, { once: true });
      try {
        controller.enqueue(encoder.encode(": connected\n\n"));
        while (!closed) {
          const events = getSseEvents(id, lastEventId);
          for (const event of events) {
            controller.enqueue(encoder.encode(formatEvent(event)));
            lastEventId = event.id;
          }
          const statusDb = getDatabase();
          const current = statusDb.prepare("SELECT status FROM agent_runs WHERE id=? AND user_id=?").get(id, A2A_SERVICE_USER_ID) as { status?: string } | undefined;
          statusDb.close();
          const status = current?.status?.toLowerCase();
          if (!current || ["completed", "failed", "cancelled", "blocked", "waiting_for_user", "interrupted"].includes(status ?? "")) {
            await delay(250);
            for (const event of getSseEvents(id, lastEventId)) {
              controller.enqueue(encoder.encode(formatEvent(event)));
              lastEventId = event.id;
            }
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

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function formatEvent(event: ReturnType<typeof getSseEvents>[number]): string {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify({ ...event.payload, analysisId: event.analysisId, createdAt: event.createdAt })}\n\n`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function a2aError(error: { status: number; code: string; message: string }): Response {
  return Response.json(
    { error: { code: error.code, message: error.message } },
    {
      status: error.status,
      headers: { "content-type": "application/a2a+json; charset=utf-8" },
    },
  );
}
