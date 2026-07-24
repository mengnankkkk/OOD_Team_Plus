import { advisorConversationMessageSchema } from "@/server/advisor/contracts";
import { advisorJsonError, apiResponse, idempotentApiResponse } from "@/server/advisor/http";
import { DEMO_USER_ID } from "@/server/advisor/seed";
import { advisorStore } from "@/server/advisor/store";
import { AdvisorService } from "@/server/advisor/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ conversationId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { conversationId } = await context.params;
    const body = advisorConversationMessageSchema.parse(await request.json());
    return await idempotentApiResponse(request, advisorStore.database, DEMO_USER_ID, "conversation.message", { conversationId, ...body }, async () => {
      const result = await new AdvisorService().sendMessage(conversationId, body);
      return {
        data: {
          userMessage: result.message,
          analysis: { id: result.analysisId, type: "ADVISORY_QA", status: "QUEUED" },
          streamUrl: result.streamUrl,
        },
        status: 202,
      };
    });
  } catch (error) {
    return advisorJsonError(error);
  }
}

export async function GET(_request: Request, context: RouteContext) {
  const { conversationId } = await context.params;
  try {
    return apiResponse({ items: new AdvisorService().listMessages(conversationId) });
  } catch (error) {
    return advisorJsonError(error);
  }
}
