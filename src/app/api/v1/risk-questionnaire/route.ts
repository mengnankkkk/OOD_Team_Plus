import { apiResponse } from "@/server/advisor/http";
import { riskQuestionnaire } from "@/server/advisor/risk-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return apiResponse(riskQuestionnaire);
}
