import type { AdvisorEvent } from "@/server/advisor/types";
import { advisorEventHub } from "@/server/advisor/event-hub";
import type { AdvisorStore } from "@/server/advisor/store";

export function formatAdvisorEvent(event: AdvisorEvent) {
  return [`id: ${event.id}`, `event: ${event.type}`, `data: ${JSON.stringify(event)}`, "", ""].join("\n");
}

export function advisorEventStream(
  store: AdvisorStore,
  analysisId: string,
  afterEventId: string | null,
  signal?: AbortSignal,
) {
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const close = () => {
    unsubscribe();
    if (heartbeat) clearInterval(heartbeat);
    try {
      controller.close();
    } catch {
      // The client may have disconnected already.
    }
  };
  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
      const replay = store.listEvents(analysisId, afterEventId);
      for (const event of replay) controller.enqueue(encoder.encode(formatAdvisorEvent(event)));
      if (replay.some((event) => ["run.completed", "run.blocked", "run.failed"].includes(event.type))) {
        close();
        return;
      }
      unsubscribe = advisorEventHub.subscribe(analysisId, (event) => {
        controller.enqueue(encoder.encode(formatAdvisorEvent(event)));
        if (["run.completed", "run.blocked", "run.failed"].includes(event.type)) close();
      });
      heartbeat = setInterval(() => controller.enqueue(encoder.encode(": heartbeat\n\n")), 15_000);
      signal?.addEventListener("abort", close, { once: true });
    },
    cancel() {
      close();
    },
  });
  return new Response(stream, {
    headers: {
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
