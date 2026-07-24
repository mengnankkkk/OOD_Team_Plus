import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { beginIdempotentRequest, parseIdempotentResponse, saveIdempotentResponse } from "@/server/extensions/middleware/idempotency";
import { createId, getDatabase, getRequestContext, idempotencyKey, isoNow, meta } from "@/server/http/context";

const Schema = z.object({ name: z.string().trim().min(1).max(100), description: z.string().max(500).optional() });

export async function POST(req: NextRequest) {
  const key = idempotencyKey(req);
  if (!key) return invalid("Idempotency-Key required");
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalid("Invalid request", parsed.error.format());
  const { userId } = getRequestContext(req);
  const idem = await beginIdempotentRequest(userId, "watchlist_create", key, parsed.data);
  if (idem.existing?.conflict) return NextResponse.json({ error: { code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key was already used with a different request" } }, { status: 409 });
  if (idem.existing) return NextResponse.json(parseIdempotentResponse(idem.existing), { status: 200 });
  const now = isoNow();
  const id = createId("watchlist");
  const db = getDatabase();
  try {
    db.prepare("INSERT INTO watchlists (id,user_id,name,description,created_at,updated_at) VALUES (?,?,?,?,?,?)").run(id, userId, parsed.data.name, parsed.data.description ?? null, now, now);
    const row = db.prepare("SELECT * FROM watchlists WHERE id=?").get(id);
    const payload = { data: row, meta: meta() };
    await saveIdempotentResponse(userId, "watchlist_create", key, idem.requestHash, payload);
    return NextResponse.json(payload, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: { code: "RESOURCE_CONFLICT", message: error instanceof Error ? error.message : "Watchlist already exists" } }, { status: 409 });
  } finally {
    db.close();
  }
}

export async function GET(req: NextRequest) {
  const raw = Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 100) : 20;
  const db = getDatabase();
  const rows = db.prepare("SELECT * FROM watchlists WHERE user_id=? AND status!='deleted' ORDER BY created_at DESC LIMIT ?").all(getRequestContext(req).userId, limit);
  db.close();
  return NextResponse.json({ data: { items: rows }, meta: meta({ pagination: { limit, nextCursor: null, hasMore: false } }) });
}

function invalid(message: string, details?: unknown) {
  return NextResponse.json({ error: { code: "INVALID_REQUEST", message, details } }, { status: 400 });
}
