import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { PasswordSchema, UsernameSchema } from "@/server/auth/contracts";
import { authError, requestIp, setSessionCookies } from "@/server/auth/http";
import { authenticateUser, createSession, enforceFixedWindowRateLimit } from "@/server/auth/service";
import { meta } from "@/server/http/context";

const Schema = z.object({ username: UsernameSchema, password: PasswordSchema });

export async function POST(request: NextRequest) {
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid credentials", details: parsed.error.format() } }, { status: 422 });
  try {
    enforceFixedWindowRateLimit({ scope: "auth_login", subject: `${requestIp(request) ?? "unknown"}:${parsed.data.username}`, limit: 10, windowSeconds: 60 });
    const user = await authenticateUser(parsed.data.username, parsed.data.password);
    const session = createSession(user, { userAgent: request.headers.get("user-agent"), ip: requestIp(request) });
    const response = NextResponse.json({ data: { user, csrfToken: session.csrfToken, expiresAt: session.expiresAt }, meta: meta() });
    setSessionCookies(response, session);
    return response;
  } catch (error) {
    return authError(error);
  }
}
