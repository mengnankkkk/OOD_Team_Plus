import { conversationPatchSchema } from "@/server/advisor/contracts";
import { advisorJsonError, apiResponse, expectedVersion, notFound } from "@/server/advisor/http";
import { DEMO_USER_ID } from "@/server/advisor/seed";
import { advisorStore } from "@/server/advisor/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ conversationId: string }> };

export async function GET(_request: Request, context: Context) {
  const { conversationId } = await context.params;
  const conversation = advisorStore.conversations.get(DEMO_USER_ID, conversationId);
  return conversation ? apiResponse({ ...conversation, pendingClarificationCount: advisorStore.conversations.listClarifications(DEMO_USER_ID, conversationId, "OPEN").length }) : notFound("会话不存在。");
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { conversationId } = await context.params;
    const conversation = advisorStore.conversations.update(DEMO_USER_ID, conversationId, conversationPatchSchema.parse(await request.json()), expectedVersion(request));
    return conversation ? apiResponse(conversation) : notFound("会话不存在。");
  } catch (error) {
    return advisorJsonError(error);
  }
}
