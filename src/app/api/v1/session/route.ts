import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createId, getDatabase, getRequestContext, hashSessionToken, isoNow, meta } from "@/server/http/context";

const Schema = z.object({ displayName: z.string().trim().min(1).max(80).optional(), useDemoUser: z.boolean().default(false) });
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export async function POST(req: NextRequest) {
  const parsed = Schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid session request", details: parsed.error.format() } }, { status: 422 });
  const now = isoNow();
  const userId = parsed.data.useDemoUser ? "demo-user" : createId("user");
  const sessionId = createId("session");
  const token = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  const db = getDatabase();
  const create = db.transaction(() => {
    if (!parsed.data.useDemoUser) db.prepare("INSERT INTO users (id,display_name,created_at) VALUES (?,?,?)").run(userId, parsed.data.displayName ?? "Investor", now);
    db.prepare("INSERT INTO api_sessions (id,user_id,token_hash,expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?,?)").run(sessionId, userId, hashSessionToken(token), expiresAt, now, now);
  });
  create();
  db.close();
  const response = NextResponse.json({ data: { userId, sessionId, csrfToken, expiresAt }, meta: meta() }, { status: 201 });
  response.cookies.set("mw_session", token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_MAX_AGE_SECONDS });
  response.cookies.set("mw_csrf", csrfToken, { httpOnly: false, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_MAX_AGE_SECONDS });
  return response;
}

export async function GET(req: NextRequest) {
  const context = getRequestContext(req);
  return NextResponse.json({ data: { userId: context.userId, sessionId: context.sessionId, authenticated: Boolean(req.cookies.get("mw_session")) }, meta: meta() });
}

export async function DELETE(req: NextRequest) {
  const token = req.cookies.get("mw_session")?.value;
  if (token) {
    const db = getDatabase();
    db.prepare("DELETE FROM api_sessions WHERE token_hash=?").run(hashSessionToken(token));
    db.close();
  }
  const response = new NextResponse(null, { status: 204 });
  response.cookies.delete("mw_session");
  response.cookies.delete("mw_csrf");
  return response;
}
