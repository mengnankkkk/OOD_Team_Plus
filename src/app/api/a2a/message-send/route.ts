import { NextRequest } from "next/server";

import { capabilityAdapters } from "@/server/a2a/adapter-registry";
import { createA2ARequestHandlers } from "@/server/a2a/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const { handleJsonRpcA2ARequest } = createA2ARequestHandlers(capabilityAdapters);

export async function POST(request: NextRequest) {
  return handleJsonRpcA2ARequest(request);
}
