import { apiResponse } from "@/server/advisor/http";
import { RecommendationService } from "@/server/advisor/recommendation-service";
import { advisorStore } from "@/server/advisor/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  return apiResponse(new RecommendationService(advisorStore).list({
    action: url.searchParams.get("action") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
  }));
}
