import { advisorJsonError, apiResponse } from "@/server/advisor/http";
import { EvidenceService } from "@/server/advisor/evidence-service";
import { advisorStore } from "@/server/advisor/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ analysisId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const { analysisId } = await context.params;
    const includeToolPayload = new URL(request.url).searchParams.get("includeToolPayload") === "true";
    return apiResponse(new EvidenceService(advisorStore).getPack(analysisId, includeToolPayload));
  } catch (error) {
    return advisorJsonError(error);
  }
}
