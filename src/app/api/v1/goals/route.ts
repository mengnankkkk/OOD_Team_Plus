import { goalCreateSchema } from "@/server/advisor/contracts";
import { advisorJsonError, apiResponse } from "@/server/advisor/http";
import { DEMO_USER_ID } from "@/server/advisor/seed";
import { advisorStore } from "@/server/advisor/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return apiResponse({ items: advisorStore.profile.listGoals(DEMO_USER_ID) });
}

export async function POST(request: Request) {
  try {
    const body = goalCreateSchema.parse(await request.json());
    return apiResponse(advisorStore.profile.createGoal(DEMO_USER_ID, body), 201);
  } catch (error) {
    return advisorJsonError(error);
  }
}
