import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { AuthFailure, type AuthUser } from "./contracts";
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, type AppLocale } from "@/i18n/config";
import { localizedErrorMessage } from "@/i18n/errors";
import { resolveWebLocale } from "@/i18n/resolve-locale";

export function authError(error: unknown, request?: NextRequest): NextResponse {
  const locale = resolveWebLocale({
    cookieLocale: request?.cookies.get(LOCALE_COOKIE_NAME)?.value,
    acceptLanguage: request?.headers.get("accept-language"),
  }).locale;
  if (error instanceof AuthFailure) {
    return localizedJson({ error: { code: error.code, message: localizedErrorMessage(error.code, locale) } }, error.status, locale);
  }
  return localizedJson({ error: { code: "INTERNAL_ERROR", message: localizedErrorMessage("INTERNAL_ERROR", locale) } }, 500, locale);
}

export function requireAdmin(user: AuthUser): void {
  if (user.role !== "ADMIN") throw new AuthFailure("FORBIDDEN", 403, "Administrator access is required");
}

export function requestIp(request: NextRequest): string | null {
  if (!trustProxyHeaders()) return null;
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip");
}

export function setSessionCookies(response: NextResponse, session: { token: string; csrfToken: string; maxAge: number }, request?: NextRequest): void {
  const forwardedProto = trustProxyHeaders()
    ? request?.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase()
    : undefined;
  const requestProtocol = request?.nextUrl.protocol.replace(":", "").toLowerCase();
  const secure = (forwardedProto ?? requestProtocol) === "https";
  response.cookies.set("mw_session", session.token, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: session.maxAge });
  response.cookies.set("mw_csrf", session.csrfToken, { httpOnly: false, sameSite: "lax", secure, path: "/", maxAge: session.maxAge });
}

export function setLocaleCookie(response: NextResponse, locale: AppLocale, request?: NextRequest): void {
  const forwardedProto = request?.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const requestProtocol = request?.nextUrl.protocol.replace(":", "").toLowerCase();
  const secure = (forwardedProto ?? requestProtocol) === "https";
  response.cookies.set(LOCALE_COOKIE_NAME, locale, { httpOnly: false, sameSite: "lax", secure, path: "/", maxAge: 60 * 60 * 24 * 365 });
}

export function clearSessionCookies(response: NextResponse): void {
  response.cookies.delete("mw_session");
  response.cookies.delete("mw_csrf");
}

function trustProxyHeaders(): boolean {
  return process.env.TRUST_PROXY_HEADERS?.toLowerCase() === "true";
}

export function localizedJson(data: unknown, status: number, locale = DEFAULT_LOCALE): NextResponse {
  const response = NextResponse.json(data, { status });
  response.headers.set("Content-Language", locale);
  return response;
}

export function localizedNoContent(locale = DEFAULT_LOCALE): NextResponse {
  const response = new NextResponse(null, { status: 204 });
  response.headers.set("Content-Language", locale);
  return response;
}
