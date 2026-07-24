import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { PasswordSchema, UsernameSchema } from "@/server/auth/contracts";
import { authError, requestIp, setSessionCookies } from "@/server/auth/http";
import { createSession, enforceFixedWindowRateLimit, registerUser } from "@/server/auth/service";
import { meta } from "@/server/http/context";

const Schema = z.object({
  username: UsernameSchema,
  password: PasswordSchema,
  displayName: z.string().trim().min(1).max(80).optional(),
});

export async function POST(request: NextRequest) {
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid registration", details: parsed.error.format() } }, { status: 422 });
  try {
    enforceFixedWindowRateLimit({ scope: "auth_register", subject: requestIp(request) ?? "unknown", limit: 5, windowSeconds: 60 });
    const user = await registerUser(parsed.data);
    const session = createSession(user, { userAgent: request.headers.get("user-agent"), ip: requestIp(request) });
    const response = NextResponse.json({ data: { user, csrfToken: session.csrfToken, expiresAt: session.expiresAt }, meta: meta() }, { status: 201 });
    setSessionCookies(response, session);
    return response;
  } catch (error) {
    return authError(error);
  }
}
