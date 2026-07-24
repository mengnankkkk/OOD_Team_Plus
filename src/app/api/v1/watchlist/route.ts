import { watchlistCreateSchema } from "@/server/advisor/contracts";
import { advisorJsonError, apiResponse, idempotentApiResponse } from "@/server/advisor/http";
import { DEMO_USER_ID } from "@/server/advisor/seed";
import { advisorStore } from "@/server/advisor/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return apiResponse({ items: advisorStore.watchlist.list(DEMO_USER_ID) });
}

export async function POST(request: Request) {
  try {
    const body = watchlistCreateSchema.parse(await request.json());
    return await idempotentApiResponse(request, advisorStore.database, DEMO_USER_ID, "watchlist.add", body, () => ({
      data: advisorStore.watchlist.add(DEMO_USER_ID, body.instrumentId, body.note),
      status: 201,
    }));
  } catch (error) {
    return advisorJsonError(error);
  }
}
