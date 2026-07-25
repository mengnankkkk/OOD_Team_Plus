import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { rotateExternalClientTokenIdempotently } from "@/server/a2a/client-idempotency-service";
import { authError, requireAdmin } from "@/server/auth/http";
import {
  getRequestContext,
  idempotencyKey,
  meta,
} from "@/server/http/context";
import { a2aAdminError } from "../../route";

const RotateSchema = z.object({}).strict();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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
  const parsed = RotateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid token rotation request",
          details: parsed.error.format(),
        },
      },
      { status: 422 },
    );
  }

  const { id } = await params;
  try {
    const responseMeta = meta();
    const result = rotateExternalClientTokenIdempotently(
      context.userId,
      id,
      { key, responseMeta },
    );
    if (result.kind === "replay") {
      return NextResponse.json(result.response, { status: 200 });
    }
    return NextResponse.json({ data: result.value, meta: responseMeta });
  } catch (error) {
    return a2aAdminError(error);
  }
}
