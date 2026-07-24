import { goalPatchSchema } from "@/server/advisor/contracts";
import { advisorJsonError, apiResponse, expectedVersion, notFound } from "@/server/advisor/http";
import { DEMO_USER_ID } from "@/server/advisor/seed";
import { advisorStore } from "@/server/advisor/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ goalId: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const { goalId } = await context.params;
    const goal = advisorStore.profile.updateGoal(DEMO_USER_ID, goalId, goalPatchSchema.parse(await request.json()), expectedVersion(request));
    return goal ? apiResponse(goal) : notFound("目标不存在。");
  } catch (error) {
    return advisorJsonError(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  const { goalId } = await context.params;
  return advisorStore.profile.deleteGoal(DEMO_USER_ID, goalId) ? new Response(null, { status: 204 }) : notFound("目标不存在。");
}
