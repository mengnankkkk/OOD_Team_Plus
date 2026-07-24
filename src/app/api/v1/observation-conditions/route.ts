import { watchConditionCreateSchema } from "@/server/advisor/contracts";
import { advisorJsonError, apiResponse, idempotentApiResponse } from "@/server/advisor/http";
import { DEMO_USER_ID } from "@/server/advisor/seed";
import { advisorStore } from "@/server/advisor/store";
import { WatchService } from "@/server/advisor/watch-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const status = new URL(request.url).searchParams.get("status") ?? undefined;
  return apiResponse({ items: new WatchService(advisorStore).list(status) });
}

export async function POST(request: Request) {
  try {
    const body = watchConditionCreateSchema.parse(await request.json());
    return await idempotentApiResponse(request, advisorStore.database, DEMO_USER_ID, "watch.create", body, () => ({
      data: new WatchService(advisorStore).create(body),
      status: 201,
    }));
  } catch (error) {
    return advisorJsonError(error);
  }
}
