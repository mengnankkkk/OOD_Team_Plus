import { clarificationAnswerSchema } from "@/server/advisor/contracts";
import { advisorJsonError, idempotentApiResponse } from "@/server/advisor/http";
import { DEMO_USER_ID } from "@/server/advisor/seed";
import { advisorStore } from "@/server/advisor/store";
import { AdvisorService } from "@/server/advisor/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ conversationId: string; clarificationId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const { conversationId, clarificationId } = await context.params;
    const body = clarificationAnswerSchema.parse(await request.json());
    return await idempotentApiResponse(request, advisorStore.database, DEMO_USER_ID, "clarification.answer", { conversationId, clarificationId, ...body }, () => ({
      data: new AdvisorService().answerClarification(conversationId, clarificationId, body),
      status: 202,
    }));
  } catch (error) {
    return advisorJsonError(error);
  }
}
