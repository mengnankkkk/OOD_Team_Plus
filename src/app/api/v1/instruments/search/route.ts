import { apiResponse } from "@/server/advisor/http";
import { advisorStore } from "@/server/advisor/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  return apiResponse({ items: advisorStore.profile.searchInstruments(url.searchParams.get("q") ?? "", url.searchParams.get("assetType") ?? undefined) });
}
