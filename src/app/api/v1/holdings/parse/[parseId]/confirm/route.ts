import { holdingConfirmSchema } from "@/server/advisor/contracts";
import { advisorJsonError, idempotentApiResponse } from "@/server/advisor/http";
import { DEMO_USER_ID } from "@/server/advisor/seed";
import { advisorStore } from "@/server/advisor/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ parseId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const { parseId } = await context.params;
    const body = holdingConfirmSchema.parse(await request.json());
    return await idempotentApiResponse(request, advisorStore.database, DEMO_USER_ID, "holding.confirm", { parseId, ...body }, () => ({
      data: advisorStore.holdings.confirmDraft(DEMO_USER_ID, parseId, body.confirmedCandidates, request.headers.get("Idempotency-Key") ?? undefined),
      status: 201,
    }));
  } catch (error) {
    return advisorJsonError(error);
  }
}
