import { NextRequest, NextResponse } from "next/server";

import { resetUserPassword } from "@/server/auth/admin-service";
import { authError, requireAdmin } from "@/server/auth/http";
import { getRequestContext, meta } from "@/server/http/context";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = getRequestContext(request);
    requireAdmin(context.user);
    const result = await resetUserPassword(context.user, (await params).id);
    return NextResponse.json({ data: result, meta: meta() });
  } catch (error) {
    return authError(error);
  }
}
