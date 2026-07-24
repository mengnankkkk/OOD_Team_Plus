import { holdingParseSchema } from "@/server/advisor/contracts";
import { advisorJsonError, apiResponse } from "@/server/advisor/http";
import { parseHoldingText } from "@/server/advisor/holding-parser";
import { DEMO_USER_ID } from "@/server/advisor/seed";
import { advisorStore } from "@/server/advisor/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = holdingParseSchema.parse(await request.json());
    return apiResponse(parseHoldingText(advisorStore, { ...body, userId: DEMO_USER_ID }), 200);
  } catch (error) {
    return advisorJsonError(error);
  }
}
