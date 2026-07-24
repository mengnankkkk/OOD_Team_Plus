import { advisorJsonError, idempotentApiResponse } from "@/server/advisor/http";
import { DEMO_USER_ID } from "@/server/advisor/seed";
import { advisorStore } from "@/server/advisor/store";
import { AdvisorService } from "@/server/advisor/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ analysisId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const { analysisId } = await context.params;
    return await idempotentApiResponse(request, advisorStore.database, DEMO_USER_ID, "analysis.retry", { analysisId }, () => ({
      data: new AdvisorService().retryAnalysis(analysisId),
      status: 202,
    }));
  } catch (error) {
    return advisorJsonError(error);
  }
}
