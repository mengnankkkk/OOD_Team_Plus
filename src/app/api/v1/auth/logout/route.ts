import { NextRequest, NextResponse } from "next/server";

import { clearSessionCookies } from "@/server/auth/http";
import { revokeSession } from "@/server/auth/service";

export async function POST(request: NextRequest) {
  revokeSession(request.cookies.get("mw_session")?.value);
  const response = new NextResponse(null, { status: 204 });
  clearSessionCookies(response);
  return response;
}
