import { notFound } from "@/server/advisor/http";
import { advisorEventStream } from "@/server/advisor/sse";
import { advisorStore } from "@/server/advisor/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ analysisId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { analysisId } = await context.params;
  if (!advisorStore.hasAnalysis(analysisId)) return notFound("分析不存在。");
  const afterEventId = request.headers.get("Last-Event-ID");
  return advisorEventStream(advisorStore, analysisId, afterEventId, request.signal);
}
