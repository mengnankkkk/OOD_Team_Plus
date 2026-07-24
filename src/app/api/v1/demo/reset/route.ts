import { demoResetSchema } from "@/server/advisor/contracts";
import { advisorJsonError, idempotentApiResponse } from "@/server/advisor/http";
import { DEMO_USER_ID } from "@/server/advisor/seed";
import { advisorStore } from "@/server/advisor/store";
import { SystemService } from "@/server/advisor/system-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = demoResetSchema.parse(await request.json());
    return await idempotentApiResponse(request, advisorStore.database, DEMO_USER_ID, "demo.reset", body, () => ({
      data: new SystemService(advisorStore).reset(),
      status: 200,
    }));
  } catch (error) {
    return advisorJsonError(error);
  }
}
