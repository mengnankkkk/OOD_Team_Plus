import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { PasswordSchema } from "@/server/auth/contracts";
import { authError, clearSessionCookies } from "@/server/auth/http";
import { changePassword } from "@/server/auth/service";
import { getRequestContext } from "@/server/http/context";

const Schema = z.object({ currentPassword: PasswordSchema, newPassword: PasswordSchema }).refine(
  (value) => value.currentPassword !== value.newPassword,
  { message: "New password must be different", path: ["newPassword"] },
);

export async function PUT(request: NextRequest) {
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid password change", details: parsed.error.format() } }, { status: 422 });
  try {
    const context = getRequestContext(request);
    await changePassword(context.userId, parsed.data.currentPassword, parsed.data.newPassword);
    const response = new NextResponse(null, { status: 204 });
    clearSessionCookies(response);
    return response;
  } catch (error) {
    return authError(error);
  }
}
