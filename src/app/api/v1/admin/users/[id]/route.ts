import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { UserRoleSchema, UserStatusSchema } from "@/server/auth/contracts";
import { authError, requireAdmin } from "@/server/auth/http";
import { updateUser } from "@/server/auth/admin-service";
import { getRequestContext, meta } from "@/server/http/context";

const Schema = z.object({ role: UserRoleSchema.optional(), status: UserStatusSchema.optional() })
  .refine((value) => value.role !== undefined || value.status !== undefined, "At least one field is required");

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid user update", details: parsed.error.format() } }, { status: 422 });
  const expectedVersion = Number.parseInt(request.headers.get("If-Match")?.replaceAll('"', "") ?? "", 10);
  if (!Number.isInteger(expectedVersion)) return NextResponse.json({ error: { code: "VERSION_REQUIRED", message: "If-Match is required" } }, { status: 428 });
  try {
    const context = getRequestContext(request);
    requireAdmin(context.user);
    const user = updateUser(context.user, (await params).id, { ...parsed.data, expectedVersion });
    return NextResponse.json({ data: { user }, meta: meta() });
  } catch (error) {
    return authError(error);
  }
}
