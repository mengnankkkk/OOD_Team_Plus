import { conversationCreateSchema } from "@/server/advisor/contracts";
import { advisorJsonError, apiResponse } from "@/server/advisor/http";
import { DEMO_USER_ID } from "@/server/advisor/seed";
import { advisorStore } from "@/server/advisor/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return apiResponse({ items: advisorStore.conversations.list(DEMO_USER_ID) });
}

export async function POST(request: Request) {
  try {
    return apiResponse(advisorStore.conversations.create(DEMO_USER_ID, conversationCreateSchema.parse(await request.json())), 201);
  } catch (error) {
    return advisorJsonError(error);
  }
}
