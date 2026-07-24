import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { AuthFailure, type AuthUser } from "./contracts";

export function authError(error: unknown): NextResponse {
  if (error instanceof AuthFailure) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "Authentication operation failed" } }, { status: 500 });
}

export function requireAdmin(user: AuthUser): void {
  if (user.role !== "ADMIN") throw new AuthFailure("FORBIDDEN", 403, "Administrator access is required");
}

export function requestIp(request: NextRequest): string | null {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip");
}

export function setSessionCookies(response: NextResponse, session: { token: string; csrfToken: string; maxAge: number }): void {
  const secure = process.env.NODE_ENV === "production";
  response.cookies.set("mw_session", session.token, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: session.maxAge });
  response.cookies.set("mw_csrf", session.csrfToken, { httpOnly: false, sameSite: "lax", secure, path: "/", maxAge: session.maxAge });
}

export function clearSessionCookies(response: NextResponse): void {
  response.cookies.delete("mw_session");
  response.cookies.delete("mw_csrf");
}
