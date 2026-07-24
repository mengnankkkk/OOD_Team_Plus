import { profilePatchSchema } from "@/server/advisor/contracts";
import { advisorJsonError, apiResponse, expectedVersion } from "@/server/advisor/http";
import { DEMO_USER_ID } from "@/server/advisor/seed";
import { advisorStore } from "@/server/advisor/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return apiResponse(advisorStore.profile.getProfile(DEMO_USER_ID));
}

export async function PATCH(request: Request) {
  try {
    const body = profilePatchSchema.parse(await request.json());
    const current = advisorStore.profile.getProfile(DEMO_USER_ID);
    if (expectedVersion(request) != null && expectedVersion(request) !== current?.version) {
      throw new Error("VERSION_CONFLICT");
    }
    return apiResponse(advisorStore.profile.patchProfile(DEMO_USER_ID, body));
  } catch (error) {
    return advisorJsonError(error);
  }
}
