import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { rotateExternalClientToken } from "@/server/a2a/client-service";
import { authError, requireAdmin } from "@/server/auth/http";
import {
  beginIdempotentRequest,
  parseIdempotentResponse,
  saveIdempotentResponse,
} from "@/server/extensions/middleware/idempotency";
import {
  getRequestContext,
  idempotencyKey,
  meta,
} from "@/server/http/context";
import { a2aAdminError, idempotencyConflict } from "../../route";

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
  const routeCode = `admin_a2a_client_rotate:${id}`;
  const idem = await beginIdempotentRequest(
    context.userId,
    routeCode,
    key,
    { clientId: id },
  );
  if (idem.existing?.conflict) return idempotencyConflict();
  if (idem.existing) {
    return NextResponse.json(parseIdempotentResponse(idem.existing), { status: 200 });
  }

  try {
    const result = rotateExternalClientToken(context.userId, id);
    const responseMeta = meta();
    await saveIdempotentResponse(
      context.userId,
      routeCode,
      key,
      idem.requestHash,
      { data: { tokenPrefix: result.tokenPrefix }, meta: responseMeta },
    );
    return NextResponse.json({ data: result, meta: responseMeta });
  } catch (error) {
    return a2aAdminError(error);
  }
}
