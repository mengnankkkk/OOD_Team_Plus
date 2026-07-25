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
  const rawBody = await request.text();
  let body: unknown = {};
  if (rawBody.length > 0) {
    try {
      body = JSON.parse(rawBody) as unknown;
    } catch {
      return validationError();
    }
  }
  const parsed = RotateSchema.safeParse(body);
  if (!parsed.success) {
    return validationError(parsed.error.format());
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

function validationError(details?: unknown): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid token rotation request",
        ...(details === undefined ? {} : { details }),
      },
    },
    { status: 422 },
  );
}
