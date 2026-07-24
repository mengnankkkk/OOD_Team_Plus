import { NextRequest, NextResponse } from "next/server";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function proxy(request: NextRequest) {
  if (!MUTATING_METHODS.has(request.method) || !request.cookies.has("mw_session")) return NextResponse.next();
  const cookieToken = request.cookies.get("mw_csrf")?.value;
  const headerToken = request.headers.get("X-CSRF-Token");
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return NextResponse.json({ error: { code: "CSRF_VALIDATION_FAILED", message: "X-CSRF-Token does not match the active session" } }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/api/v1/:path*"] };
