import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  getExternalClient,
  updateExternalClient,
} from "@/server/a2a/client-service";
import { A2A_CAPABILITIES } from "@/server/a2a/contracts";
import { authError, requireAdmin } from "@/server/auth/http";
import { getRequestContext, meta } from "@/server/http/context";
import { a2aAdminError } from "../route";

const CapabilitySchema = z.enum(A2A_CAPABILITIES);
const UpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  capabilities: z.array(CapabilitySchema).min(1).max(A2A_CAPABILITIES.length)
    .refine((items) => new Set(items).size === items.length, "Capabilities must be unique")
    .optional(),
  rateLimitPerMinute: z.number().int().min(1).max(10_000).optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one field is required");

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    requireAdmin(getRequestContext(request).user);
  } catch (error) {
    return authError(error);
  }
  const client = getExternalClient((await params).id);
  if (!client) return notFound();
  return NextResponse.json({ data: { client }, meta: meta() });
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  let context: ReturnType<typeof getRequestContext>;
  try {
    context = getRequestContext(request);
    requireAdmin(context.user);
  } catch (error) {
    return authError(error);
  }

  const expectedVersion = parseVersion(request);
  if (expectedVersion === null) {
    return NextResponse.json(
      { error: { code: "VERSION_REQUIRED", message: "A numeric If-Match header is required" } },
      { status: 428 },
    );
  }
  const parsed = UpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid external A2A client update",
          details: parsed.error.format(),
        },
      },
      { status: 422 },
    );
  }

  try {
    const client = updateExternalClient(context.userId, (await params).id, {
      ...parsed.data,
      expectedVersion,
    });
    return NextResponse.json({ data: { client }, meta: meta() });
  } catch (error) {
    return a2aAdminError(error);
  }
}

function parseVersion(request: NextRequest): number | null {
  const value = Number.parseInt(
    request.headers.get("If-Match")?.replaceAll('"', "") ?? "",
    10,
  );
  return Number.isInteger(value) && value > 0 ? value : null;
}

function notFound(): NextResponse {
  return NextResponse.json(
    { error: { code: "RESOURCE_NOT_FOUND", message: "External A2A client not found" } },
    { status: 404 },
  );
}
