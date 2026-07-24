import { decisionCreateSchema } from "@/server/advisor/contracts";
import { advisorJsonError, idempotentApiResponse } from "@/server/advisor/http";
import { DEMO_USER_ID } from "@/server/advisor/seed";
import { advisorStore } from "@/server/advisor/store";
import { RecommendationService } from "@/server/advisor/recommendation-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ recommendationId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const { recommendationId } = await context.params;
    const body = decisionCreateSchema.parse(await request.json());
    const clientRequestId = request.headers.get("Idempotency-Key") ?? undefined;
    return await idempotentApiResponse(request, advisorStore.database, DEMO_USER_ID, "recommendation.decision", { recommendationId, ...body }, () => ({
      data: new RecommendationService(advisorStore).recordDecision(recommendationId, { ...body, clientRequestId }),
      status: 201,
    }));
  } catch (error) {
    return advisorJsonError(error);
  }
}
