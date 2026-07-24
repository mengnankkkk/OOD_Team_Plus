import { watchEvaluateSchema } from "@/server/advisor/contracts";
import { advisorJsonError, idempotentApiResponse } from "@/server/advisor/http";
import { DEMO_USER_ID } from "@/server/advisor/seed";
import { advisorStore } from "@/server/advisor/store";
import { WatchService } from "@/server/advisor/watch-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = watchEvaluateSchema.parse(await request.json());
    return await idempotentApiResponse(request, advisorStore.database, DEMO_USER_ID, "watch.evaluate", body, async () => ({
      data: await new WatchService(advisorStore).evaluate(body.conditionIds),
      status: 200,
    }));
  } catch (error) {
    return advisorJsonError(error);
  }
}
