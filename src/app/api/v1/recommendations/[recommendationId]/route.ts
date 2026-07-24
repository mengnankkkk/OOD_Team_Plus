import { advisorJsonError, apiResponse } from "@/server/advisor/http";
import { RecommendationService } from "@/server/advisor/recommendation-service";
import { advisorStore } from "@/server/advisor/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ recommendationId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { recommendationId } = await context.params;
    return apiResponse(new RecommendationService(advisorStore).get(recommendationId));
  } catch (error) {
    return advisorJsonError(error);
  }
}
