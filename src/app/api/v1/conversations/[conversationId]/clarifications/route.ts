import { apiResponse } from "@/server/advisor/http";
import { DEMO_USER_ID } from "@/server/advisor/seed";
import { advisorStore } from "@/server/advisor/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ conversationId: string }> };

export async function GET(_request: Request, context: Context) {
  const { conversationId } = await context.params;
  return apiResponse({ items: advisorStore.conversations.listClarifications(DEMO_USER_ID, conversationId, "OPEN") });
}
