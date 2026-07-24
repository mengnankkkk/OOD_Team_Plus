import { NextRequest, NextResponse } from "next/server";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function proxy(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith("/api/v1/")) return NextResponse.next();
  if (!MUTATING_METHODS.has(request.method) || !request.cookies.has("mw_session")) return NextResponse.next();
  const expectedOrigin = process.env.APP_ORIGIN;
  const requestOrigin = request.headers.get("origin");
  if (expectedOrigin && requestOrigin && requestOrigin !== expectedOrigin) {
    return NextResponse.json({ error: { code: "ORIGIN_VALIDATION_FAILED", message: "Request origin is not allowed" } }, { status: 403 });
  }
  const cookieToken = request.cookies.get("mw_csrf")?.value;
  const headerToken = request.headers.get("X-CSRF-Token");
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return NextResponse.json({ error: { code: "CSRF_VALIDATION_FAILED", message: "X-CSRF-Token does not match the active session" } }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/api/v1/:path*"] };
