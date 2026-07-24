import { riskAssessmentSchema } from "@/server/advisor/contracts";
import { advisorJsonError, apiResponse } from "@/server/advisor/http";
import { scoreRiskAssessment } from "@/server/advisor/risk-service";
import { DEMO_USER_ID } from "@/server/advisor/seed";
import { advisorStore } from "@/server/advisor/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = riskAssessmentSchema.parse(await request.json());
    const result = scoreRiskAssessment(body);
    return apiResponse(advisorStore.profile.saveRiskAssessment(DEMO_USER_ID, result), 201);
  } catch (error) {
    return advisorJsonError(error);
  }
}
