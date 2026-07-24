import { advisorJsonError, apiResponse } from "@/server/advisor/http";
import { DEMO_USER_ID } from "@/server/advisor/seed";
import { advisorStore } from "@/server/advisor/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ simulationId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { simulationId } = await context.params;
    const result = advisorStore.decisions.getSimulation(DEMO_USER_ID, simulationId);
    if (!result) throw new Error("RESOURCE_NOT_FOUND");
    return apiResponse(result);
  } catch (error) {
    return advisorJsonError(error);
  }
}
