import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { domainResponse, invalid, parseVersion } from "@/server/extensions/watchlists/http";
import { getWatchlistItem, removeWatchlistItem, updateWatchlistItem } from "@/server/extensions/watchlists/service";
import { getRequestContext, meta } from "@/server/http/context";

const PatchItemSchema = z.object({
  reason: z.string().trim().max(500).nullable().optional(),
  plannedHorizon: z.string().trim().max(120).nullable().optional(),
  goalId: z.string().trim().min(1).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one field is required");

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  try {
    return NextResponse.json({ data: getWatchlistItem(getRequestContext(request).userId, id), meta: meta() });
  } catch (error) {
    return domainResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const version = parseVersion(request);
  if (version === null) return invalid("A numeric If-Match header is required");
  const parsed = PatchItemSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid("Invalid watchlist item update", parsed.error.format());
  const { id } = await params;
  try {
    return NextResponse.json({
      data: updateWatchlistItem(getRequestContext(request).userId, id, parsed.data, version),
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
    removeWatchlistItem(getRequestContext(request).userId, id, version);
    return new Response(null, { status: 204 });
  } catch (error) {
    return domainResponse(error);
  }
}
