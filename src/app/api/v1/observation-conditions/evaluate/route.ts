import { NextRequest } from "next/server";

import { evaluateConditions } from "@/server/extensions/notifications/alert-engine";
import { getRequestContext, meta } from "@/server/http/context";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { conditionIds?: string[]; reason?: string } | null;
  const items = evaluateConditions(body?.conditionIds, body?.reason ?? `manual:${getRequestContext(req).userId}`);
  return Response.json({ data: { items }, meta: meta() });
}
