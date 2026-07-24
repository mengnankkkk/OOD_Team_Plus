import { apiResponse } from "@/server/advisor/http";
import { DEMO_USER_ID } from "@/server/advisor/seed";
import { advisorStore } from "@/server/advisor/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const action = new URL(request.url).searchParams.get("action") ?? undefined;
  return apiResponse({ items: advisorStore.decisions.listDecisions(DEMO_USER_ID, action) });
}
