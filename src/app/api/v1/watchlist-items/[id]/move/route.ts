import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { domainResponse, invalid, parseVersion } from "@/server/extensions/watchlists/http";
import { moveWatchlistItem } from "@/server/extensions/watchlists/service";
import { getRequestContext, meta } from "@/server/http/context";

const Schema = z.object({ targetWatchlistId: z.string().trim().min(1) });
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  const version = parseVersion(request);
  if (version === null) return invalid("A numeric If-Match header is required");
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid("Invalid move request", parsed.error.format());
  const { id } = await params;
  try {
    return NextResponse.json({
      data: moveWatchlistItem(getRequestContext(request).userId, id, parsed.data.targetWatchlistId, version),
      meta: meta(),
    });
  } catch (error) {
    return domainResponse(error);
  }
}
