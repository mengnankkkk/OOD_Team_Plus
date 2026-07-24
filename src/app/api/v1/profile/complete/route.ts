import { profileCompleteSchema } from "@/server/advisor/contracts";
import { advisorJsonError, apiResponse } from "@/server/advisor/http";
import { DEMO_USER_ID } from "@/server/advisor/seed";
import { advisorStore } from "@/server/advisor/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    profileCompleteSchema.parse(await request.json());
    const profile = advisorStore.profile.getProfile(DEMO_USER_ID);
    if (!profile?.effectiveRiskLevel) throw new Error("PROFILE_INCOMPLETE");
    return apiResponse({ profileId: profile.id, status: "COMPLETE", effectiveRiskLevel: profile.effectiveRiskLevel, version: profile.version });
  } catch (error) {
    return advisorJsonError(error);
  }
}
