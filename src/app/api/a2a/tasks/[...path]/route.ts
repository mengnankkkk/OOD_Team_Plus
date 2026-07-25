import { NextRequest } from "next/server";

import { capabilityAdapters } from "@/server/a2a/adapter-registry";
import { createA2ARequestHandlers } from "@/server/a2a/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const { handleHttpTaskRequest } = createA2ARequestHandlers(capabilityAdapters);

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: RouteContext) {
  return handleHttpTaskRequest(request, (await context.params).path);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return handleHttpTaskRequest(request, (await context.params).path);
}
