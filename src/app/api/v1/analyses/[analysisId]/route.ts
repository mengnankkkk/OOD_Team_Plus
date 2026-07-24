import { advisorJsonError, apiResponse } from "@/server/advisor/http";
import { AdvisorService } from "@/server/advisor/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ analysisId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { analysisId } = await context.params;
    return apiResponse(new AdvisorService().getAnalysis(analysisId));
  } catch (error) {
    return advisorJsonError(error);
  }
}
