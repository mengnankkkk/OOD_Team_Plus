import { analysisCreateSchema } from "@/server/advisor/contracts";
import { advisorJsonError, idempotentApiResponse } from "@/server/advisor/http";
import { DEMO_USER_ID } from "@/server/advisor/seed";
import { advisorStore } from "@/server/advisor/store";
import { AdvisorService } from "@/server/advisor/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = analysisCreateSchema.parse(await request.json());
    return await idempotentApiResponse(request, advisorStore.database, DEMO_USER_ID, "analysis.create", body, () => ({
      data: new AdvisorService().startAnalysis(body.conversationId, body.type, body.input),
      status: 202,
    }));
  } catch (error) {
    return advisorJsonError(error);
  }
}
