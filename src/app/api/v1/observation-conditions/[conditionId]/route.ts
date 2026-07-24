import { watchConditionPatchSchema } from "@/server/advisor/contracts";
import { advisorJsonError, apiResponse, expectedVersion } from "@/server/advisor/http";
import { advisorStore } from "@/server/advisor/store";
import { WatchService } from "@/server/advisor/watch-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ conditionId: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const { conditionId } = await context.params;
    return apiResponse(new WatchService(advisorStore).update(conditionId, watchConditionPatchSchema.parse(await request.json()), expectedVersion(request)));
  } catch (error) {
    return advisorJsonError(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const { conditionId } = await context.params;
    new WatchService(advisorStore).remove(conditionId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return advisorJsonError(error);
  }
}
