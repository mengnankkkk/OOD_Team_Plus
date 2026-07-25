import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  listExternalClients,
} from "@/server/a2a/client-service";
import { createExternalClientIdempotently } from "@/server/a2a/client-idempotency-service";
import { A2A_CAPABILITIES, A2APublicError } from "@/server/a2a/contracts";
import { authError, requireAdmin } from "@/server/auth/http";
import {
  getRequestContext,
  idempotencyKey,
  meta,
} from "@/server/http/context";

const CapabilitySchema = z.enum(A2A_CAPABILITIES);
const CreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  capabilities: z.array(CapabilitySchema).min(1).max(A2A_CAPABILITIES.length)
    .refine((items) => new Set(items).size === items.length, "Capabilities must be unique"),
  rateLimitPerMinute: z.number().int().min(1).max(10_000).default(60),
});

export async function POST(request: NextRequest) {
  let context: ReturnType<typeof getRequestContext>;
  try {
    context = getRequestContext(request);
    requireAdmin(context.user);
  } catch (error) {
    return authError(error);
  }

  const key = idempotencyKey(request);
  if (!key) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "Idempotency-Key required" } },
      { status: 400 },
    );
  }
  const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid external A2A client",
          details: parsed.error.format(),
        },
      },
      { status: 422 },
    );
  }

  try {
    const responseMeta = meta();
    const result = createExternalClientIdempotently(
      context.userId,
      parsed.data,
      { key, responseMeta },
    );
    if (result.kind === "replay") {
      return NextResponse.json(result.response, { status: 200 });
    }
    return NextResponse.json(
      { data: result.value, meta: responseMeta },
      { status: 201 },
    );
  } catch (error) {
    return a2aAdminError(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    requireAdmin(getRequestContext(request).user);
    return NextResponse.json({
      data: { items: listExternalClients() },
      meta: meta(),
    });
  } catch (error) {
    return a2aAdminError(error);
  }
}

export function a2aAdminError(error: unknown): NextResponse {
  if (error instanceof A2APublicError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  return authError(error);
}
