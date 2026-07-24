import { NextRequest, NextResponse } from "next/server";

import { authError } from "@/server/auth/http";
import { getRequestContext, meta } from "@/server/http/context";

export async function GET(request: NextRequest) {
  try {
    return NextResponse.json({ data: { user: getRequestContext(request).user }, meta: meta() });
  } catch (error) {
    return authError(error);
  }
}
