import { watchlistPatchSchema } from "@/server/advisor/contracts";
import { advisorJsonError, apiResponse, notFound } from "@/server/advisor/http";
import { DEMO_USER_ID } from "@/server/advisor/seed";
import { advisorStore } from "@/server/advisor/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ itemId: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const { itemId } = await context.params;
    const body = watchlistPatchSchema.parse(await request.json());
    const item = advisorStore.watchlist.update(DEMO_USER_ID, itemId, body.note ?? undefined);
    return item ? apiResponse(item) : notFound("自选项不存在。");
  } catch (error) {
    return advisorJsonError(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  const { itemId } = await context.params;
  return advisorStore.watchlist.remove(DEMO_USER_ID, itemId)
    ? new Response(null, { status: 204 })
    : notFound("自选项不存在。");
}
