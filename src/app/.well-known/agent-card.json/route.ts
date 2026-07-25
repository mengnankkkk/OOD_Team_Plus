import { NextRequest } from "next/server";

import { buildAgentCard } from "@/server/a2a/agent-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return Response.json(buildAgentCard(request), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
