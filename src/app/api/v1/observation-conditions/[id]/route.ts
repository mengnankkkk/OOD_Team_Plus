import { NextRequest, NextResponse } from "next/server";

import {
  deleteCondition,
  PatchConditionSchema,
  updateCondition,
} from "@/server/extensions/notifications/condition-service";
import { domainResponse, invalid, parseVersion } from "@/server/extensions/watchlists/http";
import { getRequestContext, meta } from "@/server/http/context";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const version = parseVersion(request);
  if (version === null) return invalid("A numeric If-Match header is required");
  const parsed = PatchConditionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "OBSERVATION_CONDITION_INVALID", message: "Invalid observation condition", details: parsed.error.format() } },
      { status: 422 },
    );
  }
  const { id } = await params;
  try {
    return NextResponse.json({
      data: updateCondition(getRequestContext(request).userId, id, parsed.data, version),
      meta: meta(),
    });
  } catch (error) {
    return domainResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const version = parseVersion(request);
  if (version === null) return invalid("A numeric If-Match header is required");
  const { id } = await params;
  try {
    deleteCondition(getRequestContext(request).userId, id, version);
    return new Response(null, { status: 204 });
  } catch (error) {
    return domainResponse(error);
  }
}
