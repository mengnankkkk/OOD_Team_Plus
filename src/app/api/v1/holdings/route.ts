import { holdingCreateSchema } from "@/server/advisor/contracts";
import { advisorJsonError, apiResponse } from "@/server/advisor/http";
import { DEMO_USER_ID } from "@/server/advisor/seed";
import { advisorStore } from "@/server/advisor/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return apiResponse({ items: advisorStore.holdings.listHoldings(DEMO_USER_ID) });
}

export async function POST(request: Request) {
  try {
    const body = holdingCreateSchema.parse(await request.json());
    const instrument = body.instrumentId
      ? advisorStore.profile.getInstrument(body.instrumentId)
      : body.symbol
        ? advisorStore.profile.getInstrument(body.symbol)
        : null;
    if (!instrument) throw new Error("RESOURCE_NOT_FOUND");
    return apiResponse(advisorStore.holdings.createHolding(DEMO_USER_ID, { ...body, instrumentId: instrument.id }), 201);
  } catch (error) {
    return advisorJsonError(error);
  }
}
