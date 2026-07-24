import { holdingPatchSchema } from "@/server/advisor/contracts";
import { advisorJsonError, apiResponse, expectedVersion, notFound } from "@/server/advisor/http";
import { DEMO_USER_ID } from "@/server/advisor/seed";
import { advisorStore } from "@/server/advisor/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ holdingId: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const { holdingId } = await context.params;
    const holding = advisorStore.holdings.updateHolding(DEMO_USER_ID, holdingId, holdingPatchSchema.parse(await request.json()), expectedVersion(request));
    return holding ? apiResponse(holding) : notFound("持仓不存在。");
  } catch (error) {
    return advisorJsonError(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  const { holdingId } = await context.params;
  return advisorStore.holdings.deleteHolding(DEMO_USER_ID, holdingId) ? new Response(null, { status: 204 }) : notFound("持仓不存在。");
}
