import { apiResponse } from "@/server/advisor/http";
import { SystemService } from "@/server/advisor/system-service";
import { advisorStore } from "@/server/advisor/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return apiResponse(await new SystemService(advisorStore).health());
}
