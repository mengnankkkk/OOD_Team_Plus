import { advisorStore } from "@/server/advisor/store";
import { apiResponse, notFound } from "@/server/advisor/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ instrumentId: string }> };

export async function GET(_request: Request, context: Context) {
  const { instrumentId } = await context.params;
  const instrument = advisorStore.profile.getInstrument(instrumentId);
  return instrument ? apiResponse(instrument) : notFound("标的不存在。");
}
